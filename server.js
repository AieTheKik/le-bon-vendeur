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
    nom: row.nom || '',
    plan: row.plan || 'essential'
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
resend.emails.send({ from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>', to: email, subject: 'Confirmez votre email - Le Bon Vendeur', html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f4f0;font-family:Arial,sans-serif"><div style="max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden"><div style="background:#F56B2A;padding:36px 24px;text-align:center"><p style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px 0">Le Bon Vendeur</p><div style="font-size:40px;margin-bottom:12px">&#127881;</div><h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 6px 0;line-height:1.2">Pret a vendre comme un pro !</h1><p style="font-size:13px;color:rgba(255,255,255,0.85);margin:0">Votre coach personnel est pret</p></div><div style="padding:32px 28px"><div style="display:inline-block;background:#FEF0E8;border:1px solid #FDDCC8;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;color:#c44d0d;margin-bottom:20px">Compte active avec succes</div><p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px 0">Bonjour,<br><br>Votre compte est active. Vous avez maintenant acces a votre coach personnel de vente, pret a vous aider a vendre mieux sur Le Bon Coin.</p><table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr><td style="padding:8px 0;border-bottom:1px solid #f0efe9;vertical-align:top;width:30px"><div style="width:26px;height:26px;border-radius:50%;background:#F56B2A;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:26px">1</div></td><td style="padding:8px 0 8px 12px;border-bottom:1px solid #f0efe9;font-size:13px;color:#444;line-height:1.5"><strong style="color:#1a1a1a">Prenez une photo</strong> de votre premier objet a vendre</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #f0efe9;vertical-align:top"><div style="width:26px;height:26px;border-radius:50%;background:#F56B2A;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:26px">2</div></td><td style="padding:8px 0 8px 12px;border-bottom:1px solid #f0efe9;font-size:13px;color:#444;line-height:1.5"><strong style="color:#1a1a1a">Le Bon Vendeur genere</strong> votre annonce parfaite en 10 secondes</td></tr><tr><td style="padding:8px 0;vertical-align:top"><div style="width:26px;height:26px;border-radius:50%;background:#F56B2A;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:26px">3</div></td><td style="padding:8px 0 8px 12px;font-size:13px;color:#444;line-height:1.5"><strong style="color:#1a1a1a">Publiez et vendez</strong> — votre coach vous guide a chaque etape</td></tr></table><div style="text-align:center;margin-bottom:24px"><a href="https://le-bon-vendeur.com/auth/verify?token=${verificationToken}" style="display:inline-block;background:#F56B2A;color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none">Confirmer mon email →</a></div><p style="font-size:12px;color:#bbb;text-align:center;margin:0">Des questions ? Repondez a cet email, on est la.</p></div><div style="background:#f5f4f0;padding:18px 24px;text-align:center;border-top:1px solid #eee"><p style="font-size:11px;color:#aaa;margin:0">2025 Le Bon Vendeur · le-bon-vendeur.com</p></div></div></body></html>` });
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
    res.json({ token, user: { email, subscriptionStatus: user.subscriptionStatus, prenom: user.prenom||'', nom: user.nom||'', plan: user.plan||'essential' } });
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
  res.json({ email: user.email, subscriptionStatus: user.subscriptionStatus, prenom: user.prenom||'', nom: user.nom||'', plan: user.plan||'essential' });
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
    const nouvelleVente = { id: annonce.id, objet: annonce.objet, titre: annonce.titre, prixVente, dateVente: annonce.dateVente, categorie: annonce.categorie };
    user.ventes.push(nouvelleVente);
    await saveUser(user);
    const ventesMois2 = user.ventes.filter(v => { const d = new Date(v.dateVente); const n = new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); });
    const revMois2 = ventesMois2.reduce((s,v)=>s+parseFloat(v.prixVente||0),0);
    resend.emails.send({ from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>', to: req.userEmail, subject: 'Vente enregistree — '+(annonce.titre||annonce.objet||'Annonce'), html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f4f0;font-family:Arial,sans-serif"><div style="max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden"><div style="background:#F56B2A;padding:36px 24px;text-align:center"><p style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px 0">Le Bon Vendeur</p><div style="font-size:40px;margin-bottom:12px">&#128176;</div><h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 6px 0;line-height:1.2">Vente enregistree !</h1><p style="font-size:13px;color:rgba(255,255,255,0.85);margin:0">Felicitations pour cette belle vente</p></div><div style="padding:32px 28px"><table style="width:100%;border-collapse:collapse;background:#f5f4f0;border-radius:10px;margin-bottom:20px"><tr><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:13px;color:#888">Objet vendu</td><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">${annonce.titre||annonce.objet||'Annonce'}</td></tr><tr><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:13px;color:#888">Prix de vente</td><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:18px;font-weight:800;color:#1a6e3e;text-align:right">+${parseFloat(prixVente).toFixed(0)} €</td></tr><tr><td style="padding:10px 16px;font-size:13px;color:#888">Date</td><td style="padding:10px 16px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">${new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</td></tr></table><table style="width:100%;border-collapse:collapse;background:#f5f4f0;border-radius:10px;margin-bottom:20px"><tr><td style="padding:16px;text-align:center;border-right:1px solid #e0ddd5"><div style="font-size:22px;font-weight:800;color:#F56B2A">${ventesMois2.length}</div><div style="font-size:11px;color:#999;margin-top:4px">Ventes ce mois</div></td><td style="padding:16px;text-align:center"><div style="font-size:22px;font-weight:800;color:#F56B2A">${revMois2.toFixed(0)} €</div><div style="font-size:11px;color:#999;margin-top:4px">Revenus ce mois</div></td></tr></table><div style="background:#e8f5ef;border:1px solid #c5e8d8;border-radius:10px;padding:16px;margin-bottom:24px;text-align:center"><p style="font-size:14px;color:#1a6e3e;font-weight:500;margin:0;line-height:1.6">Le Bon Vendeur vous felicite !<br>Vous etes sur une belle lancee ce mois-ci. Continuez comme ca !</p></div><div style="text-align:center;margin-bottom:20px"><a href="https://le-bon-vendeur.com/dashboard.html" style="display:inline-block;background:#F56B2A;color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none">Voir mon tableau de bord →</a></div></div><div style="background:#f5f4f0;padding:18px 24px;text-align:center;border-top:1px solid #eee"><p style="font-size:11px;color:#aaa;margin:0">2025 Le Bon Vendeur · le-bon-vendeur.com</p></div></div></body></html>` });
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
    const ventesMois = user.ventes.filter(v => { const d = new Date(v.dateVente); const n = new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); });
    const revMois = ventesMois.reduce((s,v)=>s+parseFloat(v.prixVente||0),0);
    resend.emails.send({ from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>', to: req.userEmail, subject: 'Vente enregistree — '+vente.objet, html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f4f0;font-family:Arial,sans-serif"><div style="max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden"><div style="background:#F56B2A;padding:36px 24px;text-align:center"><p style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px 0">Le Bon Vendeur</p><div style="font-size:40px;margin-bottom:12px">&#128176;</div><h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 6px 0;line-height:1.2">Vente enregistree !</h1><p style="font-size:13px;color:rgba(255,255,255,0.85);margin:0">Felicitations pour cette belle vente</p></div><div style="padding:32px 28px"><table style="width:100%;border-collapse:collapse;background:#f5f4f0;border-radius:10px;margin-bottom:20px"><tr><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:13px;color:#888">Objet vendu</td><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">${vente.objet}</td></tr><tr><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:13px;color:#888">Prix de vente</td><td style="padding:10px 16px;border-bottom:1px solid #e8e6e0;font-size:18px;font-weight:800;color:#1a6e3e;text-align:right">+${parseFloat(vente.prixVente).toFixed(0)} €</td></tr><tr><td style="padding:10px 16px;font-size:13px;color:#888">Date</td><td style="padding:10px 16px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">${new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</td></tr></table><table style="width:100%;border-collapse:collapse;background:#f5f4f0;border-radius:10px;margin-bottom:20px"><tr><td style="padding:16px;text-align:center;border-right:1px solid #e0ddd5"><div style="font-size:22px;font-weight:800;color:#F56B2A">${ventesMois.length}</div><div style="font-size:11px;color:#999;margin-top:4px">Ventes ce mois</div></td><td style="padding:16px;text-align:center"><div style="font-size:22px;font-weight:800;color:#F56B2A">${revMois.toFixed(0)} €</div><div style="font-size:11px;color:#999;margin-top:4px">Revenus ce mois</div></td></tr></table><div style="background:#e8f5ef;border:1px solid #c5e8d8;border-radius:10px;padding:16px;margin-bottom:24px;text-align:center"><p style="font-size:14px;color:#1a6e3e;font-weight:500;margin:0;line-height:1.6">Le Bon Vendeur vous felicite !<br>Vous etes sur une belle lancee ce mois-ci. Continuez comme ca !</p></div><div style="text-align:center;margin-bottom:20px"><a href="https://le-bon-vendeur.com/dashboard.html" style="display:inline-block;background:#F56B2A;color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none">Voir mon tableau de bord →</a></div></div><div style="background:#f5f4f0;padding:18px 24px;text-align:center;border-top:1px solid #eee"><p style="font-size:11px;color:#aaa;margin:0">2025 Le Bon Vendeur · le-bon-vendeur.com</p></div></div></body></html>` });
    res.json({ ok: true, vente });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/ventes', authMiddleware, async (req, res) => {
  const row = await getUser(req.userEmail);
  const user = dbToUser(row);
  res.json(user ? user.ventes || [] : []);
});

app.post('/annonces/:id/annuler-vente', authMiddleware, async (req, res) => {
  try {
    const row = await getUser(req.userEmail);
    const user = dbToUser(row);
    const annonce = user.annonces.find(a => String(a.id) === String(req.params.id));
    if (!annonce) return res.status(404).json({ error: 'Annonce non trouvée' });
    const prixVente = annonce.prixVente;
    annonce.statut = 'en_vente';
    annonce.prixVente = null;
    annonce.dateVente = null;
    user.ventes = (user.ventes || []).filter(v => String(v.id) !== String(req.params.id));
    await saveUser(user);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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


app.post('/contact', async (req, res) => {
  try {
    const { email, message } = req.body;
    if (!email || !message) return res.status(400).json({ error: 'Champs manquants' });
    await resend.emails.send({
      from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>',
      to: 'hakim.baka@gmail.com',
      subject: 'Nouveau message de contact — ' + email,
      html: '<div style="font-family:Arial,sans-serif;padding:24px"><h2 style="color:#F56B2A">Nouveau message</h2><p><strong>De :</strong> ' + email + '</p><p><strong>Message :</strong></p><p style="background:#f5f4f0;padding:16px;border-radius:8px">' + message.replace(/\n/g,'<br>') + '</p></div>'
    });
    await resend.emails.send({
      from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>',
      to: email,
      subject: 'Votre message a bien été reçu — Le Bon Vendeur',
      html: '<div style="font-family:Arial,sans-serif;padding:24px"><h2 style="color:#F56B2A">Message bien reçu !</h2><p>Merci, nous vous répondons sous 24h.</p></div>'
    });
    res.json({ ok: true });
  } catch(e) { console.error('Contact error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/waitlist', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email manquant' });
    await supabase.from('waitlist').upsert({ email });
    resend.emails.send({
      from: 'Le Bon Vendeur <bonjour@le-bon-vendeur.com>',
      to: 'hakim.baka@gmail.com',
      subject: 'Nouveau inscrit liste attente Pro — ' + email,
      html: '<div style="font-family:Arial,sans-serif;padding:24px;max-width:500px"><h2 style="color:#F56B2A;margin-bottom:12px">Nouveau inscrit Pro !</h2><p style="font-size:15px"><strong>' + email + '</strong> vient de rejoindre la liste attente Le Bon Vendeur +</p></div>'
    });
    res.json({ ok: true });
  } catch(e) { console.error('Waitlist error:', e.message); res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('✅ Serveur Le Bon Vendeur sur port ' + PORT));

// Route analyze-url — utilisée par l'extension Chrome
app.post('/analyze-url', authMiddleware, async (req, res) => {
  try {
    const { titre, prix } = req.body;
    if (!titre || !prix) return res.status(400).json({ error: 'titre et prix requis' });
    const prompt = `Tu es Le Bon Vendeur. Analyse cette annonce LBC:\nTitre: ${titre}\nPrix actuel: ${prix}€\nRetourne UNIQUEMENT ce JSON sans markdown:\n{\n  "sellScore": 72,\n  "prixFlash": 45,\n  "prixMarche": 55,\n  "prixPremium": 70,\n  "insightPrix": "Le prix est légèrement au-dessus du marché."\n}`;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });
    const text = response.content[0].text;
    console.log('analyze-url raw:', text);
    const clean = text.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    const json = JSON.parse(clean.slice(start, end+1));
    res.json(json);
  } catch (err) {
    console.error('analyze-url error:', err);
    res.status(500).json({ error: 'Erreur analyse' });
  }
});
