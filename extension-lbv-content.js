window.lbvLoaded = true;
console.log('LBV content script chargé');

const API = 'https://le-bon-vendeur.com';
let lbvInjected = false;

async function getToken() {
  return new Promise(resolve => chrome.storage.local.get(['token','user'], d => resolve(d)));
}

function getPageType() {
  const url = window.location.href;
  if (url.includes('/messagerie') || url.includes('/messages')) return 'messagerie';
  if (url.match(/\/ad\//)) return 'annonce';
  if (url.includes('/deposer-une-annonce')) return 'depot';
  return null;
}

async function init() {
  const {token, user} = await getToken();
  if (!token || !user || user.plan !== 'pro') return;
  const type = getPageType();
  if (type === 'annonce') injectAnnonce(token);
  if (type === 'messagerie') injectMessagerie(token);
  if (type === 'depot') injectDepot(token);
}

function createFloatingPanel() {
  const host = document.createElement('div');
  host.id = 'lbv-host';
  host.style.cssText = 'position:fixed;top:80px;right:20px;z-index:2147483647;width:360px;pointer-events:all;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({mode: 'open'});
  return {host, shadow};
}

function injectAnnonce(token) {
  if (lbvInjected) return;
  lbvInjected = true;
  
  setTimeout(() => {
    if (document.getElementById('lbv-host')) return;
    
    const priceEl = document.querySelector('[data-qa-id="adview_price"] span, [class*="price"] span');
    const titleEl = document.querySelector('[data-qa-id="adview_title"] h1, h1[class*="title"], h1');
    const prix = priceEl ? parseInt(priceEl.textContent.replace(/[^0-9]/g,'')) : 0;
    const titre = titleEl ? titleEl.textContent.trim() : document.title;

    const {host, shadow} = createFloatingPanel();
    
    shadow.innerHTML = `
      <style>
        .panel { background:#fff; border:2px solid #F56B2A; border-radius:16px; overflow:hidden; font-family:-apple-system,sans-serif; box-shadow:0 4px 20px rgba(0,0,0,0.15); }
        .header { background:#F56B2A; padding:14px 18px; display:flex; align-items:center; gap:10px; }
        .logo { width:28px; height:28px; background:rgba(255,255,255,0.2); border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:#fff; }
        .title { font-size:15px; font-weight:700; color:#fff; }
        .close { background:none; border:none; color:rgba(255,255,255,0.7); cursor:pointer; font-size:20px; line-height:1; }
        .body { padding:16px 18px; }
        .loading { font-size:13px; color:#888; text-align:center; padding:20px 0; }
      </style>
      <div class="panel">
        <div class="header">
          <div class="logo">LV</div>
          <div class="title">Le Bon Vendeur</div>
          <button class="close" id="close-btn" style="margin-left:auto">×</button>
        </div>
        <div class="body" id="panel-body">
          <div class="loading">Analyse en cours...</div>
        </div>
      </div>`;
    
    shadow.getElementById('close-btn').addEventListener('click', () => host.remove());
    
    fetch(API+'/analyze-url', {
      method:'POST',
      headers:{'Content-Type':'application/json', authorization:token},
      body:JSON.stringify({titre, prix})
    }).then(r=>r.json()).then(data=>{
      const sc = data.sellScore>=75?'#1a6e3e':data.sellScore>=55?'#c44d0d':'#9e2a2a';
      const html = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;background:#fafaf8;border-radius:10px;padding:11px 13px">
          <div style="width:54px;height:54px;border-radius:50%;border:3px solid ${sc};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">
            <div style="font-size:21px;font-weight:800;color:${sc}">${data.sellScore||'—'}</div>
            <div style="font-size:10px;color:${sc}">/100</div>
          </div>
          <div>
            <div style="font-size:16px;font-weight:700;color:#1a1a1a">${data.sellScore>=75?'Très bonne annonce !':data.sellScore>=55?'Annonce correcte':'À améliorer'}</div>
            <div style="font-size:13px;color:#888;margin-top:3px">Score de vente</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
          <div style="background:#EBF2FC;border-radius:10px;padding:11px 8px;text-align:center">
            <div style="font-size:11px;color:#1a5abe;margin-bottom:5px">Flash</div>
            <div style="font-size:20px;font-weight:800;color:#1a5abe">${data.prixFlash||'—'}€</div>
          </div>
          <div style="background:#e8f5ef;border:2px solid #c5e8d8;border-radius:10px;padding:11px 8px;text-align:center">
            <div style="font-size:11px;color:#1a6e3e;margin-bottom:5px">Idéal ✓</div>
            <div style="font-size:20px;font-weight:800;color:#1a6e3e">${data.prixMarche||data.prixRecommande||'—'}€</div>
          </div>
          <div style="background:#f0ecfd;border-radius:10px;padding:11px 8px;text-align:center">
            <div style="font-size:11px;color:#5a3ab8;margin-bottom:5px">Premium</div>
            <div style="font-size:20px;font-weight:800;color:#5a3ab8">${data.prixPremium||'—'}€</div>
          </div>
        </div>
        ${data.insightPrix?`<div style="background:#FEF0E8;border-radius:10px;padding:12px 14px;font-size:13px;color:#8a3a0d;line-height:1.6;margin-bottom:14px">${data.insightPrix}</div>`:''}
        <button id='lbv-save-btn' style='width:100%;background:#F56B2A;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px'>+ Sauvegarder dans LBV</button>
        <a id='lbv-dash-link' href='#' style='display:block;text-align:center;font-size:13px;color:#F56B2A;text-decoration:none;font-weight:600'>Ouvrir le dashboard →</a>`;
      shadow.getElementById('panel-body').innerHTML = html;
    const saveBtn = shadow.getElementById('lbv-save-btn');
    const dashLink = shadow.getElementById('lbv-dash-link'); if(dashLink) dashLink.addEventListener('click', () => window.open('https://le-bon-vendeur.com/dashboard.html?token='+token, '_blank'));
    if(saveBtn) saveBtn.addEventListener('click', async () => {
      saveBtn.textContent = 'Sauvegarde...';
      saveBtn.disabled = true;
      try {
        const r = await fetch(API+'/annonces', {
          method:'POST',
          headers:{'Content-Type':'application/json', authorization:token},
          body:JSON.stringify({
            titre, prix, url:window.location.href, statut:'en_cours', origin:'leboncoin_native', imported_from_leboncoin:true,
            sellScore: data.sellScore,
            prixFlash: data.prixFlash,
            prixMarche: data.prixMarche,
            prixPremium: data.prixPremium,
            description: data.insightPrix || ''
          })
        });
        if(r.ok) { saveBtn.textContent = '✅ Voir dans le dashboard →'; saveBtn.style.background='#1a6e3e'; saveBtn.disabled = false; saveBtn.addEventListener('click', () => window.open('https://le-bon-vendeur.com/dashboard.html?token='+token, '_blank')); }
        else { saveBtn.textContent = 'Erreur'; saveBtn.disabled = false; }
      } catch(e) { saveBtn.textContent = 'Erreur'; saveBtn.disabled = false; }
    });
    }).catch(()=>{
      if(shadow.getElementById('panel-body'))
        shadow.getElementById('panel-body').innerHTML = '<div style="font-size:12px;color:#888;text-align:center">Impossible d\'analyser.</div>';
    });
    
    // Surveiller si LBC supprime le host et le recréer
    const observer = new MutationObserver(() => {
      if (!document.getElementById('lbv-host')) {
        lbvInjected = false;
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, {childList:true});

  }, 3000);
}

function injectMessagerie(token) {
  const observer = new MutationObserver(() => {
    const messages = document.querySelectorAll('[class*="message"],[class*="Message"]');
    messages.forEach(msg => {
      if (msg.dataset.lbvDone) return;
      msg.dataset.lbvDone = '1';
      const text = msg.textContent.trim();
      const offreMatch = text.match(/(\d+)\s*€/);
      if (!offreMatch) return;
      const offreMontant = parseInt(offreMatch[1]);
      if (offreMontant < 5) return;
      const bubble = document.createElement('div');
      bubble.style.cssText = 'margin:8px 0;padding:10px 14px;background:#fff;border:2px solid #F56B2A;border-radius:10px;font-family:-apple-system,sans-serif';
      bubble.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <div style="width:18px;height:18px;background:#F56B2A;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">LV</div>
          <div style="font-size:12px;font-weight:700;color:#F56B2A">Offre détectée : ${offreMontant}€</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          <button class="lbv-reply-btn" data-text="Bonjour, merci pour votre offre. Mon prix est ferme à ce tarif." style="text-align:left;padding:7px 10px;background:#f5f4f0;border:1px solid #eee;border-radius:7px;font-size:11px;color:#444;cursor:pointer;font-family:inherit">🔒 Tenir le prix</button>
          <button class="lbv-reply-btn" data-text="Bonjour ! Je peux faire un effort, disons ${Math.round(offreMontant*1.1)}€ et c'est mon dernier prix." style="text-align:left;padding:7px 10px;background:#f5f4f0;border:1px solid #eee;border-radius:7px;font-size:11px;color:#444;cursor:pointer;font-family:inherit">🤝 Contre-proposer ${Math.round(offreMontant*1.1)}€</button>
          <button class="lbv-reply-btn" data-text="Bonjour, d'accord pour ${offreMontant}€. Quand souhaitez-vous passer ?" style="text-align:left;padding:7px 10px;background:#e8f5ef;border:1px solid #c5e8d8;border-radius:7px;font-size:11px;color:#1a6e3e;cursor:pointer;font-family:inherit">✅ Accepter ${offreMontant}€</button>
        </div>`;
      msg.parentNode.insertBefore(bubble, msg.nextSibling);
      bubble.querySelectorAll('.lbv-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const textarea = document.querySelector('textarea,[contenteditable="true"]');
          if (textarea) {
            textarea.focus();
            if (textarea.tagName === 'TEXTAREA') {
              textarea.value = btn.dataset.text;
              textarea.dispatchEvent(new Event('input', {bubbles:true}));
            } else {
              textarea.textContent = btn.dataset.text;
              textarea.dispatchEvent(new Event('input', {bubbles:true}));
            }
          }
        });
      });
    });
  });
  observer.observe(document.body, {childList:true, subtree:true});
}

let depotInjected = false;
async function injectDepot(token) {
  if (depotInjected) return;
  setTimeout(async () => {
  depotInjected = true;
  const res = await fetch(API+'/annonces/pending-injection', {headers:{authorization:token}});
  const annonce = await res.json();
  if (!annonce) return;

  // Pré-remplir le titre après que LBC charge le champ
  const tryFill = setInterval(() => {
    const input = document.querySelector('input[name="subject"]');
    if (input) {
      clearInterval(tryFill);
      input.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, annonce.titre || '');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
  }, 500);

  // Afficher panneau avec les infos à copier
  setTimeout(() => {
    const {host, shadow} = createFloatingPanel();
    shadow.innerHTML = `
      <style>
        .panel { background:#fff; border:2px solid #F56B2A; border-radius:16px; overflow:hidden; font-family:-apple-system,sans-serif; box-shadow:0 4px 20px rgba(0,0,0,0.15); }
        .header { background:#F56B2A; padding:14px 18px; display:flex; align-items:center; gap:10px; }
        .logo { width:28px; height:28px; background:rgba(255,255,255,0.2); border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:#fff; }
        .close { background:none; border:none; color:rgba(255,255,255,0.7); cursor:pointer; font-size:20px; line-height:1; margin-left:auto; }
        .body { padding:16px 18px; }
        .row { margin-bottom:12px; }
        .label { font-size:11px; color:#888; margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
        .val { font-size:14px; color:#1a1a1a; background:#f5f4f0; border-radius:8px; padding:8px 10px; line-height:1.5; cursor:pointer; }
        .val:hover { background:#eee; }
        .copy-hint { font-size:10px; color:#aaa; margin-top:3px; }
      </style>
      <div class="panel">
        <div class="header">
          <div class="logo">LV</div>
          <span style="font-size:15px;font-weight:700;color:#fff">Publier sur LBC</span>
          <button class="close" id="close-btn">×</button>
        </div>
        <div class="body">
          <div class="row">
            <div class="label">Titre (pré-rempli)</div>
            <div class="val">${annonce.titre||'—'}</div>
          </div>
          <div class="row">
            <div class="label">Prix conseillé</div>
            <div class="val" id="copy-prix">${annonce.prixCible||annonce.prixRecommande||'—'} €</div>
            <div class="copy-hint">Cliquer pour copier</div>
          </div>
          <div class="row">
            <div class="label">Description</div>
            <div class="val" id="copy-desc" style="font-size:12px;max-height:100px;overflow-y:auto">${annonce.description||'—'}</div>
            <div class="copy-hint">Cliquer pour copier</div>
          </div>
        </div>
      </div>`;
    shadow.getElementById('close-btn').addEventListener('click', () => host.remove());
    shadow.getElementById('copy-prix').addEventListener('click', () => {
      navigator.clipboard.writeText(String(annonce.prixCible||annonce.prixRecommande||''));
      shadow.getElementById('copy-prix').style.background = '#e8f5ef';
    });
    shadow.getElementById('copy-desc').addEventListener('click', () => {
      navigator.clipboard.writeText(annonce.description||'');
      shadow.getElementById('copy-desc').style.background = '#e8f5ef';
    });
  }, 1000);
  }, 2000);
}

init();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if(document.body) new MutationObserver(() => init()).observe(document.body, {childList:true, subtree:false});
  });
} else {
  if(document.body) new MutationObserver(() => init()).observe(document.body, {childList:true, subtree:false});
}
