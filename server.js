const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const app = express();
app.use(cors());
app.use((req, res, next) => { if (req.originalUrl === '/webhook') { express.raw({ type: 'application/json' })(req, res, next); } else { express.json({ limit: '20mb' })(req, res, next); } });
app.use(express.static(__dirname));
app.get("/", (req, res) => res.redirect("/lebonvendeur.html"));

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

const PRICE_ID = 'price_1TJdoXCdfs6oSAwSVjIEhwWR';
const BASE_URL = 'https://le-bon-vendeur.com';

async function getUser(email) {
  const { data } = await supabase.from('users').select('*').eq('email', email).single();
  return data;
}
async function saveUser(user) {
  const { error } = await supabase.from('users').upsert({
    email: user.email,
    password: user.password,
    stripe_customer_id: user.stripeCustomerId,
    subscription_id: user.subscriptionId,
    subscription_status: user.subscriptionStatus,
    email_verified: user.emailVerified,
    verification_token: user.verificationToken,
    annonces: user.annonces || [],
    ventes: user.ventes || [],
    prenom: user.prenom || '',
    nom: user.nom || ''
  });
  return error;
}
function dbToUser(row) {
  if (!row) return null;
  return {
    email: row.email,
    password: row.password,
    stripeCustomerId: row.stripe_customer_id,
    subscriptionId: row.subscription_id,
    subscriptionStatus: row.subscription_status,
    emailVerified: row.email_verified,
    verificationToken: row.verification_token,
    annonces: row.annonces || [],
    ventes: row.ventes || [],
    prenom: row.prenom || '',
    nom: row.nom || ''
  };
}

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

// AUTH
app.post('/auth/inscription', async (req, res) => {
  try {
    const { email, password, prenom, nom } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const existing = await getUser(email);
    if (existing) return res.status(400).json({ error: 'Compte déjà existant' });
    const customer = await getStripe().customers.create({ email });
    const verificationToken = generateToken(email + 'verify');
    const newUser = { email, password: hashPassword(password), stripeCustomerId: customer.id, subscriptionId: null, subscriptionStatus: 'inactive', annonces: [], ventes: [], emailVerified: false, verificationToken, prenom: prenom||'', nom: nom||'' };
    await saveUser(newUser);
resend.emails.send({ from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>', to: email, subject: 'Confirmez votre email - Le Bon Vendeur', html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif"><div style="max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)"><div style="background:#F56B2A;padding:40px;text-align:center"><h1 style="color:white;margin:0;font-size:28px">Le Bon Vendeur</h1></div><div style="padding:40px"><h2 style="color:#1a1a1a;font-size:24px">Bienvenue, vous faites le bon choix !</h2><p style="color:#555;font-size:16px;line-height:1.6">Votre compte est cree et pret a emploi. Prenez une photo de vos objets, notre IA genere une annonce professionnelle en quelques secondes.</p><p style="color:#555;font-size:16px;line-height:1.6">Plus besoin de chercher le bon prix ou les bons mots, on s occupe pour vous.</p><div style="text-align:center;margin:40px 0"><a href="https://le-bon-vendeur.com/auth/verify?token=${verificationToken}" style="background:#F56B2A;color:white;padding:16px 40px;border-radius:100px;text-decoration:none;font-size:18px;font-weight:bold">Confirmer mon email</a></div><p style="color:#999;font-size:14px;text-align:center">Des questions ? Repondez a cet email, on est la.</p></div><div style="background:#f5f5f5;padding:24px;text-align:center"><p style="color:#aaa;font-size:12px;margin:0">2025 Le Bon Vendeur</p></div></div></body></html>` });
    res.json({ success: true, message: 'Verifiez votre email pour activer votre compte' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/auth/verify', async (req, res) => {
  const { token } = req.query;
  const { data: row } = await supabase.from('users').select('*').eq('verification_token', token).single();
  const user = dbToUser(row);
  if (!user) return res.status(400).send('Lien invalide ou expire');
  user.emailVerified = true;
  user.verificationToken = null;
  await saveUser(user);
  res.redirect('/dashboard.html?verified=true');
});

app.post('/auth/connexion', async (req, res) => {
  try {
    const { email, password } = req.body;
    const row = await getUser(email);
    const user = dbToUser(row);
    if (!user || user.password !== hashPassword(password)) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    if (!user.emailVerified) return res.status(403).json({ error: 'Veuillez verifier votre email avant de vous connecter' });
    if (false) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = generateToken(email);
    sessions[token] = email;
    res.json({ token, user: { email, subscriptionStatus: user.subscriptionStatus } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/auth/deconnexion', authMiddleware, (req, res) => {
  delete sessions[req.headers['authorization']];
  res.json({ ok: true });
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  const row = await getUser(req.userEmail);
  const user = dbToUser(row);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouve' });
  res.json({ email: user.email, subscriptionStatus: user.subscriptionStatus, prenom: user.prenom||'', nom: user.nom||'' });
});

// ABONNEMENT
app.post('/abonnement/checkout', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
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
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
    const subscriptions = await getStripe().subscriptions.list({ customer: user.stripeCustomerId, status: 'active' });
    if (subscriptions.data.length > 0) {
      user.subscriptionId = subscriptions.data[0].id;
      user.subscriptionStatus = 'active';
      await saveUser(user);
      res.json({ ok: true, status: 'active' });
    } else {
      res.json({ ok: false, status: 'inactive' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/abonnement/resilier', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
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
    const wRow = await getUser(email);
    const wUser = dbToUser(wRow);
    if (wUser && session.subscription) {
      wUser.subscriptionId = session.subscription;
      wUser.subscriptionStatus = 'active';
      await saveUser(wUser);
    }
  }
  res.json({ received: true });
});

// ANALYSE PHOTO + GÉNÉRATION ANNONCE
app.post('/analyze', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
    if (user.subscriptionStatus !== 'active') return res.status(403).json({ error: 'Abonnement requis' });
    const { imageBase64, imageType, extraInfo } = req.body;
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: `Tu es un expert en vente sur Le Bon Coin en France et en rédaction de textes commerciaux percutants.
Analyse la photo et génère une annonce de qualité professionnelle avec un Sell Score détaillé.

Le Sell Score global (0-100) est la moyenne de 4 sous-scores:
- scorePrix (0-100): prix bien positionné par rapport au marché selon l'état et la marque
- scoreClarte (0-100): titre et description précis, complets, sans ambiguïté
- scoreConfiance (0-100): annonce inspirant confiance (état détaillé, marque, accessoires mentionnés)
- scoreImpact (0-100): accroche forte, mots-clés optimaux pour la recherche LBC

Réponds UNIQUEMENT en JSON valide, sans balises markdown :
{
  "objet": "nom précis de l'objet",
  "marque": "marque si identifiable",
  "etat": "Neuf|Très bon état|Bon état|État correct|Pour pièces",
  "titre": "titre accrocheur et optimisé SEO, max 70 caractères",
  "description": "description ultra qualitative, détaillée et vendeuse, 5-8 phrases. Mentionne les points forts, l'état, les caractéristiques techniques si pertinent. Style professionnel et convaincant.",
  "prixMin": estimation basse en euros (nombre entier),
  "prixRecommande": meilleur prix de vente en euros (nombre entier),
  "prixMax": estimation haute en euros (nombre entier),
  "prixFlash": prix pour vendre en 48-72h (nombre entier, ~20% sous le marché),
  "prixMarche": prix de conversion optimale (nombre entier, identique ou proche de prixRecommande),
  "prixPremium": prix maximum ambitieux (nombre entier, ~20% au-dessus du marché),
  "prixPlancher": prix minimum absolu à ne pas franchir (nombre entier),
  "margeNego": pourcentage de marge de négociation typique pour cet objet (nombre entier, ex: 10),
  "margeNegoTexte": "phrase expliquant la marge de négociation en termes concrets",
  "prixMarcheMin": borne basse du marché observé (nombre entier),
  "prixMarcheMax": borne haute du marché observé (nombre entier),
  "insightPrix": "conseil stratégique sur le positionnement prix en 1-2 phrases",
  "categorie": "catégorie LBC principale",
  "motsCles": ["mot1", "mot2", "mot3", "mot4", "mot5"],
  "conseilVente": "conseil stratégique pour vendre rapidement",
  "scorePrix": nombre entier 0-100,
  "scoreClarte": nombre entier 0-100,
  "scoreConfiance": nombre entier 0-100,
  "scoreImpact": nombre entier 0-100,
  "sellScore": moyenne des 4 sous-scores arrondie,
  "scoreStatut": "Fort potentiel de vente|Potentiel moyen|Score faible — optimisation nécessaire",
  "actionsCorrectives": [
    {"impact": "fort", "texte": "action concrète et spécifique pour améliorer le score le plus faible"},
    {"impact": "moyen", "texte": "action concrète et spécifique pour le deuxième point faible"},
    {"impact": "faible", "texte": "action concrète et spécifique pour peaufiner l annonce"}
  ]
}`,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: extraInfo ? `Infos supplémentaires : ${extraInfo}` : "Analyse cet objet et génère l'annonce." }
      ]}]
    });
    const clean = response.content[0].text.replace(/```json|```/g, '').trim();
    const annonce = JSON.parse(clean);
    annonce.id = Date.now();
    annonce.dateCreation = new Date().toISOString();
    annonce.statut = 'en_vente';
    if (!user.annonces) user.annonces = [];
    user.annonces.push(annonce);
    await saveUser(user);
    res.json(annonce);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/annonces', authMiddleware, async (req, res) => {
  const row = await getUser(req.userEmail);
  const user = dbToUser(row);
  res.json(user ? user.annonces || [] : []);
});

// MARQUER COMME VENDU
app.post('/annonces/:id/vendu', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
    const { prixVente } = req.body;
    const annonce = user.annonces.find(a => a.id == req.params.id);
    if (!annonce) return res.status(404).json({ error: 'Annonce non trouvée' });
    annonce.statut = 'vendu';
    annonce.prixVente = prixVente;
    annonce.dateVente = new Date().toISOString();
    if (!user.ventes) user.ventes = [];
    user.ventes.push({
      id: annonce.id,
      objet: annonce.objet,
      titre: annonce.titre,
      prixVente,
      dateVente: annonce.dateVente,
      categorie: annonce.categorie
    });
    await saveUser(user);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AJOUTER UNE VENTE MANUELLE
app.post('/ventes', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
    const { objet, prixVente, dateVente, categorie, plateforme } = req.body;
    if (!user.ventes) user.ventes = [];
    const vente = {
      id: Date.now(),
      objet,
      titre: objet,
      prixVente: parseFloat(prixVente),
      dateVente: dateVente || new Date().toISOString(),
      categorie: categorie || 'Autre',
      plateforme: plateforme || 'Le Bon Coin',
      manuel: true
    };
    user.ventes.push(vente);
    await saveUser(user);
    res.json({ ok: true, vente });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/ventes', authMiddleware, async (req, res) => {
  const row = await getUser(req.userEmail);
  const user = dbToUser(row);
  res.json(user ? user.ventes || [] : []);
});

app.delete('/ventes/:id', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
    user.ventes = (user.ventes || []).filter(v => v.id != req.params.id);
    await saveUser(user);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('✅ Serveur Le Bon Vendeur sur port ' + PORT));
