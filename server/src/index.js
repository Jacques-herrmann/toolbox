// Toolbox API — Cloudflare Worker
// - /setup, /callback : connexion OAuth à Twake Workplace (cozy-stack), une seule fois
// - /health           : état (protégé par APP_SECRET)
// - /scan             : reçoit un PDF, l'IA choisit dossier + nom, upload dans Twake
import Anthropic from '@anthropic-ai/sdk';
import { Buffer } from 'node:buffer';

const MODEL = 'claude-haiku-5-5';
const SCOPE = 'io.cozy.files';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      switch (url.pathname) {
        case '/setup': return await setup(url, env);
        case '/callback': return await callback(url, env);
        case '/health': requireAuth(request, env); return cors(json(await health(env)));
        case '/test': requireAuth(request, env); return cors(json(await selfTest(env)));
        case '/scan':
          requireAuth(request, env);
          if (request.method !== 'POST') return cors(json({ error: 'POST attendu' }, 405));
          return cors(json(await scan(request, env)));
        default: return new Response('Toolbox API', { status: 200 });
      }
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      return cors(json({ error: e.message || String(e) }, status));
    }
  },
};

// ---------- HTTP utils ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const html = (body, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:24px">${body}`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
function cors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Note');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function requireAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.APP_SECRET || !timingSafeEqual(token, env.APP_SECRET)) throw new HttpError(401, 'Clé invalide');
}
const twakeBase = (env) => env.TWAKE_URL.replace(/\/+$/, '');

// ---------- OAuth Twake (cozy-stack) ----------
async function setup(url, env) {
  if (!timingSafeEqual(url.searchParams.get('key') || '', env.APP_SECRET || '')) return html('Clé invalide.', 401);
  const redirectUri = `${url.origin}/callback`;
  let client = await env.TOKENS.get('client', 'json');
  if (!client || client.redirect_uri !== redirectUri) {
    const r = await fetch(`${twakeBase(env)}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        client_name: 'Toolbox Scanner',
        software_id: 'github.com/toolbox-scanner',
        client_kind: 'web',
      }),
    });
    if (!r.ok) return html(`Enregistrement du client OAuth refusé par Twake (${r.status}) :<pre>${escapeHtml(await r.text())}</pre>`, 502);
    const reg = await r.json();
    client = { client_id: reg.client_id, client_secret: reg.client_secret, registration_access_token: reg.registration_access_token, redirect_uri: redirectUri };
    await env.TOKENS.put('client', JSON.stringify(client));
  }
  const state = crypto.randomUUID();
  await env.TOKENS.put(`state:${state}`, '1', { expirationTtl: 600 });
  const auth = new URL(`${twakeBase(env)}/auth/authorize`);
  auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, state, response_type: 'code', scope: SCOPE }).toString();
  return Response.redirect(auth.toString(), 302);
}

async function callback(url, env) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !(await env.TOKENS.get(`state:${state}`))) return html('Lien expiré, recommence depuis l’app.', 400);
  await env.TOKENS.delete(`state:${state}`);
  if (!code) return html(`Connexion annulée : ${escapeHtml(url.searchParams.get('error') || '')}`, 400);
  const client = await env.TOKENS.get('client', 'json');
  const tokens = await tokenRequest(env, client, { grant_type: 'authorization_code', code });
  await saveTokens(env, tokens);
  return html('✅ Twake est connecté. Tu peux fermer cette page et revenir au Scanner.');
}

async function tokenRequest(env, client, params) {
  const r = await fetch(`${twakeBase(env)}/auth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: client.client_id, client_secret: client.client_secret }),
  });
  if (!r.ok) throw new HttpError(502, `Twake a refusé le jeton (${r.status}) : ${await r.text()}`);
  return r.json();
}

async function saveTokens(env, t, previous = {}) {
  const data = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || previous.refresh_token,
    expires_at: Date.now() + ((t.expires_in || 86400) - 300) * 1000,
  };
  await env.TOKENS.put('tokens', JSON.stringify(data));
  return data;
}

async function accessToken(env) {
  const tokens = await env.TOKENS.get('tokens', 'json');
  if (!tokens) throw new HttpError(409, 'Twake n’est pas connecté : ouvre /setup depuis les réglages du Scanner.');
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  const client = await env.TOKENS.get('client', 'json');
  const fresh = await tokenRequest(env, client, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  return (await saveTokens(env, fresh, tokens)).access_token;
}

// ---------- API fichiers Twake ----------
async function twake(env, path, init = {}) {
  const token = await accessToken(env);
  const r = await fetch(`${twakeBase(env)}${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.api+json', ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  return r;
}

async function dirByPath(env, path) {
  const r = await twake(env, `/files/metadata?Path=${encodeURIComponent(path)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, `Twake (${r.status}) sur ${path} : ${await r.text()}`);
  return (await r.json()).data;
}

async function subdirs(env, dirId) {
  const out = [];
  let next = `/files/${dirId}`;
  while (next) {
    const r = await twake(env, next);
    if (!r.ok) throw new HttpError(502, `Twake (${r.status}) : ${await r.text()}`);
    const j = await r.json();
    for (const item of j.included || []) {
      if (item.attributes?.type === 'directory' && !item.attributes.trashed) out.push({ id: item.id, path: item.attributes.path, name: item.attributes.name });
    }
    next = j.links?.next || null;
  }
  return out;
}

async function folderTree(env, root, maxDepth = 4, maxFolders = 400) {
  const cached = await env.TOKENS.get('tree', 'json');
  if (cached && cached.root === root && Date.now() - cached.at < 15 * 60 * 1000) return cached.paths;
  const rootDir = await dirByPath(env, root);
  if (!rootDir) throw new HttpError(400, `Le dossier racine « ${root} » n’existe pas dans Twake.`);
  const paths = [root];
  let level = [{ id: rootDir.id, depth: 0 }];
  while (level.length && paths.length < maxFolders) {
    const nextLevel = [];
    for (const d of level) {
      if (d.depth >= maxDepth) continue;
      for (const s of await subdirs(env, d.id)) {
        paths.push(s.path);
        nextLevel.push({ id: s.id, depth: d.depth + 1 });
        if (paths.length >= maxFolders) break;
      }
    }
    level = nextLevel;
  }
  paths.sort((a, b) => a.localeCompare(b, 'fr'));
  await env.TOKENS.put('tree', JSON.stringify({ root, at: Date.now(), paths }));
  return paths;
}

const cleanName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

async function ensureFolder(env, root, path) {
  const rootDir = await dirByPath(env, root);
  const rel = path.slice(root.length).split('/').map(cleanName).filter((s) => s && s !== '.' && s !== '..');
  let current = rootDir, created = false, currentPath = root;
  for (const seg of rel) {
    currentPath = `${currentPath.replace(/\/$/, '')}/${seg}`;
    let dir = await dirByPath(env, currentPath);
    if (!dir) {
      const r = await twake(env, `/files/${current.id}?Type=directory&Name=${encodeURIComponent(seg)}`, { method: 'POST' });
      if (r.status === 409) dir = await dirByPath(env, currentPath);
      else if (!r.ok) throw new HttpError(502, `Création du dossier « ${currentPath} » refusée (${r.status}) : ${await r.text()}`);
      else { dir = (await r.json()).data; created = true; }
    }
    current = dir;
  }
  if (created) await env.TOKENS.delete('tree');
  return { dir: current, path: currentPath, created };
}

async function upload(env, dirId, baseName, bytes) {
  for (let i = 0; i < 20; i++) {
    const name = `${baseName}${i ? ` (${i + 1})` : ''}.pdf`;
    const r = await twake(env, `/files/${dirId}?Type=file&Name=${encodeURIComponent(name)}&CreatedAt=${new Date().toISOString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    if (r.status === 409) continue; // un fichier du même nom existe déjà
    if (!r.ok) throw new HttpError(502, `Upload refusé par Twake (${r.status}) : ${await r.text()}`);
    return { name, file: (await r.json()).data };
  }
  throw new HttpError(409, 'Trop de fichiers portant déjà ce nom.');
}

async function health(env) {
  const tokens = await env.TOKENS.get('tokens', 'json');
  const k = (env.ANTHROPIC_API_KEY || '').trim();
  const claudeKey = k ? 'présente' : 'manquante';
  return { ok: true, twake: !!tokens, claudeKey, instance: env.TWAKE_URL, root: env.ROOT_FOLDER };
}

// Vérifie la clé Claude (appel gratuit au Models API) et la lecture des dossiers Twake.
async function selfTest(env) {
  const result = {};
  try {
    const m = await new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).models.retrieve(MODEL);
    result.claude = `ok (${m.id})`;
  } catch (e) {
    result.claude = `erreur ${e.status || ''} : ${e.error?.error?.message || e.message}`;
  }
  try {
    await env.TOKENS.delete('tree');
    const folders = await folderTree(env, (env.ROOT_FOLDER || '/').replace(/\/+$/, '') || '/');
    result.twake = `ok (${folders.length} dossiers)`;
    result.sample = folders.slice(0, 8);
  } catch (e) {
    result.twake = `erreur : ${e.message}`;
  }
  return result;
}

// ---------- Classification par Claude ----------
const SCHEMA = {
  type: 'object',
  properties: {
    doc_type: { type: 'string', description: 'Type de document en français (ex. Facture, Fiche de paie, Avis d’imposition, Contrat, Relevé bancaire, Ordonnance…)' },
    issuer: { type: 'string', description: 'Émetteur / organisme, nom court (ex. EDF, Free, CPAM, DGFiP). Vide si inconnu.' },
    doc_date: { type: 'string', description: 'Date principale du document au format YYYY-MM-DD, ou chaîne vide si introuvable' },
    folder_path: { type: 'string', description: 'Chemin absolu du dossier de destination, sous le dossier racine' },
    filename: { type: 'string', description: 'Nom du fichier SANS extension' },
    summary: { type: 'string', description: 'Résumé en une phrase (montant, période, objet)' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['doc_type', 'issuer', 'doc_date', 'folder_path', 'filename', 'summary', 'confidence'],
  additionalProperties: false,
};

function systemPrompt(root, today) {
  return `Tu ranges des documents administratifs scannés dans le drive personnel de l'utilisateur.
Tu reçois un PDF (photos de documents papier), la liste des dossiers existants sous « ${root} », et parfois un indice de l'utilisateur.

Choix du dossier :
- Choisis de préférence un dossier EXISTANT de la liste, le plus précis possible.
- Respecte les conventions déjà présentes : si les dossiers voisins sont rangés par année (ex. « 2025 »), par organisme ou par personne, fais pareil.
- Si aucun dossier ne convient, propose un nouveau chemin logique sous « ${root} » (un ou deux niveaux à créer au maximum), avec des noms courts en français dans le même style que l'existant.
- folder_path doit commencer exactement par « ${root} ».

Nom du fichier : « YYYY-MM-DD - Émetteur - Type » (ex. « 2026-03-14 - EDF - Facture »). Sans date connue, commence par l'émetteur. Pas d'extension, pas de caractères / \\ : * ? " < > |.

L'indice de l'utilisateur, s'il y en a un, est prioritaire sur ta propre interprétation. Date du jour : ${today}.`;
}

// Buffer natif (nodejs_compat) : bien plus rapide qu'une boucle JS, important pour le quota CPU du Worker.
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

async function classify(env, pdfBytes, folders, note, root) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Haiku 5.5 : pas de fallback serveur sur refus (géré plus bas via stop_reason).
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: systemPrompt(root, new Date().toISOString().slice(0, 10)),
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(pdfBytes) } },
        { type: 'text', text: `Dossiers existants :\n${folders.join('\n')}\n\nIndice de l'utilisateur : ${note || '(aucun)'}` },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'L’IA a refusé d’analyser ce document.');
  if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'Réponse de l’IA tronquée, réessaie.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new HttpError(502, 'Réponse de l’IA illisible.'); }
}

// ---------- /scan ----------
async function scan(request, env) {
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, 'PDF vide');
  if (bytes.byteLength > 30 * 1024 * 1024) throw new HttpError(413, 'PDF trop lourd (30 Mo max)');
  const note = decodeURIComponent(request.headers.get('X-Note') || '').slice(0, 500);
  const root = (env.ROOT_FOLDER || '/').replace(/\/+$/, '') || '/';

  const folders = await folderTree(env, root);
  const ai = await classify(env, bytes, folders, note, root);
  // ?dry=1 : renvoie la décision de l'IA sans rien envoyer dans Twake
  if (new URL(request.url).searchParams.get('dry') === '1') return { ok: true, dry: true, ...ai };

  // Garde-fou : le dossier doit rester sous la racine
  let target = String(ai.folder_path || root).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  if (target.split('/').includes('..') || !(target === root || target.startsWith(root === '/' ? '/' : `${root}/`))) target = root;

  const { dir, path, created } = await ensureFolder(env, root, target);
  const baseName = cleanName(ai.filename) || cleanName(`${ai.doc_date} - ${ai.issuer} - ${ai.doc_type}`) || 'Scan';
  const { name } = await upload(env, dir.id, baseName, bytes);

  const drive = env.DRIVE_URL || twakeBase(env).replace(/^https:\/\/([^.]+)\./, 'https://$1-drive.');
  return {
    ok: true,
    path,
    filename: name,
    createdFolder: created,
    docType: ai.doc_type,
    summary: ai.summary,
    confidence: ai.confidence,
    link: `${drive}/#/folder/${dir.id}`,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
