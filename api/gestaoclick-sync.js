// gestaoclick-sync — backend entre o app e o ERP Gestão Click
// Variáveis de ambiente (configuradas na Vercel, NÃO aqui):
//   GC_ACCESS_TOKEN, GC_SECRET_ACCESS_TOKEN
// Opcional: ALLOW_ORIGIN (domínio do app; default "*")

const BASE = "https://api.gestaoclick.com/api"; // se der 404, teste sem o "/api"
const HORIZON_DIAS = 180;
const PAGE_DELAY_MS = 350; // respeita o limite de 3 req/s

const headers = () => ({
  "access-token": process.env.GC_ACCESS_TOKEN,
  "secret-access-token": process.env.GC_SECRET_ACCESS_TOKEN,
  "Content-Type": "application/json",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10);

async function gcGetAll(path, params = {}) {
  const out = [];
  let pagina = 1;
  while (true) {
    const qs = new URLSearchParams({ ...params, pagina: String(pagina) });
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: headers() });
    if (res.status === 429) { await sleep(1500); continue; }
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || [];
    out.push(...data);
    const proxima = json.meta && json.meta.proxima_pagina;
    if (proxima) { pagina = proxima; await sleep(PAGE_DELAY_MS); }
    else if (!json.meta && data.length === 100) { pagina += 1; await sleep(PAGE_DELAY_MS); }
    else break;
  }
  return out;
}

const normaliza = (item, tipo) => ({
  id: item.id,
  contaId: item.conta_bancaria_id,
  contaNome: item.nome_conta_bancaria,
  tipo,
  descricao: item.descricao,
  categoria: item.nome_plano_conta,
  valor: parseFloat(item.valor_total || item.valor || "0"),
  vencimento: item.data_vencimento,
  situacao: item.liquidado === "1" ? "liquidado" : "previsto",
});

async function montarSnapshot() {
  const hoje = new Date();
  const fim = new Date(hoje); fim.setDate(fim.getDate() + HORIZON_DIAS);
  const filtro = { liquidado: "ab", data_fim: ymd(fim) };

  const contas = await gcGetAll("/contas_bancarias");
  await sleep(PAGE_DELAY_MS);
  const recebimentos = await gcGetAll("/recebimentos", filtro);
  await sleep(PAGE_DELAY_MS);
  const pagamentos = await gcGetAll("/pagamentos", filtro);

  const lancamentos = [
    ...recebimentos.map((r) => normaliza(r, "entrada")),
    ...pagamentos.map((p) => normaliza(p, "saida")),
  ].filter((l) => l.contaId && l.vencimento);

  return {
    geradoEm: new Date().toISOString(),
    contas: contas.map((c) => ({ id: c.id, nome: c.nome })),
    lancamentos,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const snapshot = await montarSnapshot();
    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json(snapshot);
  } catch (err) {
    return res.status(500).json({ erro: String(err.message || err) });
  }
}
