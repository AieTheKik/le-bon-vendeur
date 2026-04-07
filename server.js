const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

let _anthropic = null;
let _stripe = null;

function getAnthropic() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getStripe() {
  if (!_stripe) {
    const Stripe = require('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

const PRICE_ID = 'price_1TJawMCdfs6oSAwSYgr6aKN4';
const BASE_URL = 'https://le-bon-vendeur-production-1822.up.railway.app';

const DB_FILE = './db.json';
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) { return {}; }
}
function saveDB(users) {
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}
const users = loadDB();

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}
function generateToken(email) {
  return crypto.createHash('sha256').update(email + Date.now()).digest('hex');
}
const sessions = {};

function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Non connecté' });
  req.userEmail = sessions[token];
  next();
}

app.post('/auth/inscription', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (users[email]) return res.status(400).json({ error: 'Compte déjà existant' });
    const customer = await getStripe().customers.create({ email });
    users[email] = { email, password: hashPassword(password), stripeCustomerId: customer.id, subscriptionId: null, subscriptionStatus: 'inactive', annonces: [] };
    saveDB(users);
    const token = generateToken(email);
    sessions[token] = email;
    res.json({ token, user: { email, subscriptionStatus: 'inactive' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/auth/connexion', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users[email];
    if (!user || user.password !== hashPassword(password)) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = generateToken(email);
    sessions[token] = email;
    res.json({ token, user: { email, subscriptionStatus: user.subscriptionStatus } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/auth/deconnexion', authMiddleware, (req, res) => {
  delete sessions[req.headers['authorization']];
  res.json({ ok: true });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  const user = users[req.userEmail];
  res.json({ email: user.email, subscriptionStatus: user.subscriptionStatus });
});

app.post('/abonnement/checkout', authMiddleware, async (req, res) => {
  try {
    const user = users[req.userEmail];
    const session = await getStripe().checkout.sessions.create({
      customer: user.stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      mode: 'subscription',
      success_url: BASE_URL + '/dashboard.html?abonnement=succes',
      cancel_url: BASE_URL + '/dashboard.html?abonnement=annule',
      metadata: { email: req.userEmail }
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/abonnement/activer', authMiddleware, async (req, res) => {
  try {
    const user = users[req.userEmail];
    const subscriptions = await getStripe().subscriptions.list({ customer: user.stripeCustomerId, status: 'active' });
    if (subscriptions.data.length > 0) {
      user.subscriptionId = subscriptions.data[0].id;
      user.subscriptionStatus = 'active';
      saveDB(users);
      res.json({ ok: true, status: 'active' });
    } else {
      res.json({ ok: false, status: 'inactive' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/abonnement/resilier', authMiddleware, async (req, res) => {
  try {
    const user = users[req.userEmail];
    if (!user.subscriptionId) return res.status(400).json({ error: 'Aucun abonnement actif' });
    await getStripe().subscriptions.update(user.subscriptionId, { cancel_at_period_end: true });
    res.json({ ok: true, message: "Abonnement résilié — accès jusqu'à la fin de la période" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) { return res.status(400).send('Webhook Error: ' + err.message); }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.metadata.email;
    if (users[email] && session.subscription) {
      users[email].subscriptionId = session.subscription;
      users[email].subscriptionStatus = 'active';
      saveDB(users);
    }
  }
  res.json({ received: true });
});

app.post('/analyze', authMiddleware, async (req, res) => {
  try {
    const user = users[req.userEmail];
    if (user.subscriptionStatus !== 'active') return res.status(403).json({ error: 'Abonnement requis' });
    const { imageBase64, imageType, extraInfo } = req.body;
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `Tu es un expert en vente sur Le Bon Coin en France. Analyse la photo et génère une annonce optimisée. Réponds UNIQUEMENT en JSON valide, sans balises markdown :
{"objet":"nom","etat":"état","titre":"titre max 70 chars","description":"description 3-5 phrases","prix_min":0,"prix_recommande":0,"prix_max":0,"categorie":"catégorie","sous_categorie":"sous-catégorie","mots_cles":["mot1"],"conseils":"conseil","options_recommandees":["option1"]}`,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: extraInfo ? `Infos : ${extraInfo}` : "Génère l'annonce." }
      ]}]
    });
    const clean = response.content[0].text.replace(/```json|```/g, '').trim();
    const annonce = JSON.parse(clean);
    annonce.id = Date.now();
    user.annonces.push(annonce);
    saveDB(users);
    res.json(annonce);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/annonces', authMiddleware, (req, res) => {
  res.json(users[req.userEmail].annonces || []);
});

app.post('/negocier', authMiddleware, async (req, res) => {
  try {
    const user = users[req.userEmail];
    if (user.subscriptionStatus !== 'active') return res.status(403).json({ error: 'Abonnement requis' });
    const { messages, prixAffiche, prixPlancher, objetDescription } = req.body;
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: `Tu es un vendeur particulier sur Le Bon Coin qui vend : ${objetDescription}.
Prix affiché : ${prixAffiche}€. Prix minimum absolu (ne jamais révéler) : ${prixPlancher}€.
- Réponds en français, vouvoiement, ton neutre et courtois
- Si l'acheteur propose un prix ÉGAL OU AU-DESSUS du plancher : accepte immédiatement
- Si l'acheteur propose un prix EN-DESSOUS du plancher : décline poliment et contre-propose
- Ne révèle JAMAIS le prix plancher
- 1-2 phrases maximum, direct et efficace
- Si accord : confirme et propose un rendez-vous`,
      messages
    });
    res.json({ reponse: response.content[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('✅ Serveur Le Bon Vendeur sur port ' + PORT));
