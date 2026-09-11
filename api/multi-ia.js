export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const { message, category = 'geral' } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Envie uma demanda.' });

  const keys = {
    Gemini: String(process.env.GEMINI_API_KEY || '').trim(),
    Groq: String(process.env.GROQ_API_KEY || '').trim(),
    DeepSeek: String(process.env.DEEPSEEK_API_KEY || '').trim(),
    OpenRouter: String(process.env.OPENROUTER_API_KEY || '').trim()
  };
  const configured = Object.entries(keys).filter(([, key]) => key);
  if (!configured.length) return res.status(503).json({ error: 'Configure ao menos uma chave de API no ambiente de hospedagem.' });

  const route = chooseRoute(String(category), String(message), keys);
  const selected = route.providers.filter(name => keys[name]);
  const results = await Promise.allSettled(selected.map(name => ask(name, keys[name], message, category)));
  const statuses = results.map((r, i) => ({ provider: selected[i], ok: r.status === 'fulfilled' && !!r.value, error: r.status === 'rejected' ? String(r.reason?.message || r.reason) : null }));
  const analyses = results.map((r, i) => ({ provider: selected[i], answer: r.status === 'fulfilled' ? r.value : null, error: r.status === 'rejected' ? String(r.reason?.message || r.reason) : null })).filter(x => x.answer);

  let conclusion = '';
  let synthesisStatus = null;
  if (analyses.length >= 2 && keys.Groq) {
    try {
      conclusion = await synthesize(keys.Groq, message, category, analyses);
      synthesisStatus = { provider: 'Groq', ok: !!conclusion, error: null };
    } catch (e) {
      synthesisStatus = { provider: 'Groq', ok: false, error: String(e.message || e) };
    }
  }

  return res.status(200).json({
    mode: conclusion ? 'conselho-multi-ia' : analyses.length > 1 ? 'comparacao' : 'fallback',
    route: route.label,
    selectedProviders: selected,
    answers: analyses,
    conclusion,
    statuses: synthesisStatus ? [...statuses, synthesisStatus] : statuses
  });
}

function chooseRoute(category, message, keys) {
  const text = `${category} ${message}`.toLowerCase();
  const has = name => !!keys[name];
  let providers;
  let label;
  if (/c[oó]digo|programa|programa[cç][aã]o|bug|api|javascript|python|software/.test(text)) {
    providers = ['DeepSeek', 'Groq', 'Gemini']; label = 'Rota técnica';
  } else if (/pesquisa|mercado|concorrente|atual|not[ií]cia|lei|regula[cç][aã]o|benchmark|dados recentes/.test(text) || category.includes('Pesquisa')) {
    providers = ['Gemini', 'OpenRouter', 'Groq']; label = 'Rota de pesquisa e análise';
  } else if (/texto|escrev|copy|legenda|email|proposta|documento|conte[uú]do/.test(text) || category.includes('Escrita')) {
    providers = ['Groq', 'Gemini', 'OpenRouter']; label = 'Rota de escrita executiva';
  } else if (/marketing|vendas|faturamento|cliente|neg[oó]cio|empresa|estrat[eé]gia|lideran[cç]a|gest[aã]o/.test(text) || category === 'geral') {
    providers = ['Gemini', 'Groq', 'OpenRouter']; label = 'Rota de conselho empresarial';
  } else {
    providers = ['Gemini', 'Groq', 'OpenRouter']; label = `Rota especializada: ${category}`;
  }
  const available = providers.filter(has);
  if (!available.length) return { providers: Object.keys(keys).filter(has), label: 'Rota de fallback' };
  return { providers: available, label };
}

function buildPrompt(message, category) {
  return `Voce e parte de um Conselho Multi-IA Empresarial. Area: ${category}. Analise a demanda com foco pratico e executivo. Traga: diagnostico, pontos fortes e fracos, evidencias ou premissas, riscos, oportunidades, alternativas e recomendacao. Nao invente dados atuais. Se algo depender de pesquisa externa, sinalize claramente. Outra IA comparara sua analise, portanto seja objetivo e nao repita frases vazias. Responda em portugues do Brasil.\n\nDEMANDA:\n${message}`;
}

async function readApiError(response, name) {
  const text = await response.text();
  let detail = text;
  try { const json = JSON.parse(text); detail = json.error?.message || json.error?.code || json.message || text; } catch (_) {}
  return `${name} HTTP ${response.status}: ${String(detail).slice(0, 500)}`;
}

async function ask(name, key, message, category) {
  const prompt = buildPrompt(message, category);
  if (name === 'Gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) });
    if (!r.ok) throw new Error(await readApiError(r,name));
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  }
  if (name === 'OpenRouter') {
    const model = String(process.env.OPENROUTER_MODEL || '').trim();
    if (!model) throw new Error('OpenRouter: configure OPENROUTER_MODEL no Vercel.');
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'HTTP-Referer':'https://conselho-multi-ia.vercel.app','X-Title':'Conselho Multi-IA'}, body:JSON.stringify({model,temperature:0.2,messages:[{role:'system',content:prompt},{role:'user',content:message}]}) });
    if (!r.ok) throw new Error(await readApiError(r,name));
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
  }
  const url = name === 'DeepSeek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  const model = name === 'DeepSeek' ? 'deepseek-v4-flash' : 'openai/gpt-oss-120b';
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key}, body:JSON.stringify({model,temperature:0.2,messages:[{role:'system',content:prompt},{role:'user',content:message}]}) });
  if (!r.ok) throw new Error(await readApiError(r,name));
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

async function synthesize(groqKey, message, category, analyses) {
  const dossier = analyses.map((x, i) => `ANALISE ${i + 1} — ${x.provider}\n${x.answer}`).join('\n\n---\n\n');
  const prompt = `Voce e o presidente do Conselho Multi-IA Empresarial. Consolide as analises abaixo para a demanda original. Nao escolha uma resposta por popularidade: compare convergencias, divergencias, qualidade dos argumentos e riscos. Nao invente fatos que nao aparecem nas analises. Se houver necessidade de pesquisa atual, diga isso. Entregue SOMENTE nesta estrutura, em portugues do Brasil:\n\nCONCLUSAO DO CONSELHO\n[decisao executiva clara]\n\nO QUE TODAS CONCORDAM\n[3 a 5 pontos]\n\nONDE DIVERGEM\n[pontos de divergencia ou diga que nao ha divergencias relevantes]\n\nEVIDENCIAS E PREMISSAS\n[o que sustenta a decisao e o que precisa ser validado]\n\nRISCOS\n[principais riscos e mitigacoes]\n\nOPORTUNIDADES\n[principais oportunidades]\n\nMELHOR DECISAO\n[recomendacao objetiva]\n\nPLANO DE ACAO 1 → 2 → 3 → 4\n[quatro passos praticos]\n\nDEMANDA: ${message}\nAREA: ${category}\n\n${dossier}`;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqKey}, body:JSON.stringify({model:'openai/gpt-oss-120b',temperature:0.1,messages:[{role:'system',content:prompt},{role:'user',content:message}]}) });
  if (!r.ok) throw new Error(await readApiError(r,'Sintese Groq'));
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}
