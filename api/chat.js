const PROVIDERS = {
  gemini: {
    env: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
  },
  openrouter: {
    env: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions'
  }
};

const CATEGORY_ROUTING = {
  'Raciocínio e análise': 'gemini',
  'Escrita executiva': 'openrouter',
  'Pesquisa empresarial': 'openrouter',
  'Estudos e documentos': 'gemini',
  'Programação': 'openrouter',
  'Dados e produtividade': 'gemini',
  'Marketing e conteúdo': 'openrouter',
  'Tradução': 'gemini',
  'Modelos open-source': 'openrouter'
};

const SYSTEM = `Você é a Central de IA Empresarial. Responda em português do Brasil, com linguagem executiva, clara e prática. Ajude a tomar decisões, estruturar problemas, criar planos e produzir textos profissionais. Não invente dados. Quando faltarem informações, diga o que falta e proponha o próximo passo. Organize respostas com títulos e bullets quando isso melhorar a clareza.`;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function getKey(provider) {
  return process.env[PROVIDERS[provider].env];
}

async function callGemini(message, history) {
  const key = getKey('gemini');
  if (!key) throw new Error('GEMINI_API_KEY não configurada');
  const contents = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: message }] }
  ];
  const r = await fetch(`${PROVIDERS.gemini.url}?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { temperature: 0.4 } })
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const data = await r.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || 'Não foi possível gerar uma resposta.';
}

async function callOpenRouter(message, history) {
  const key = getKey('openrouter');
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');
  const r = await fetch(PROVIDERS.openrouter.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openrouter/free',
      messages: [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: message }]
    })
  });
  if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || 'Não foi possível gerar uma resposta.';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  try {
    const { message, category, history = [] } = req.body || {};
    if (!message || typeof message !== 'string') return json(res, 400, { error: 'message é obrigatório.' });
    const safeHistory = Array.isArray(history) ? history.slice(-10).filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string') : [];
    const preferred = CATEGORY_ROUTING[category] || 'gemini';
    const providers = preferred === 'gemini' ? ['gemini', 'openrouter'] : ['openrouter', 'gemini'];
    let lastError;
    for (const provider of providers) {
      if (!getKey(provider)) continue;
      try {
        const answer = provider === 'gemini' ? await callGemini(message, safeHistory) : await callOpenRouter(message, safeHistory);
        return json(res, 200, { answer, provider, category: category || null });
      } catch (e) { lastError = e; }
    }
    return json(res, 503, { error: 'Nenhum provedor configurado ou disponível.', detail: lastError?.message || 'Configure GEMINI_API_KEY ou OPENROUTER_API_KEY.' });
  } catch (e) {
    return json(res, 500, { error: 'Erro interno.', detail: e.message });
  }
};
