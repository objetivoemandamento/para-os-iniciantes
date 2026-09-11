export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const { message, category = 'geral' } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Envie uma demanda.' });

  const providers = [
    ['GEMINI_API_KEY', 'Gemini'],
    ['GROQ_API_KEY', 'Groq'],
    ['DEEPSEEK_API_KEY', 'DeepSeek']
  ];

  const configured = providers.filter(([key]) => process.env[key]);
  if (!configured.length) {
    return res.status(503).json({
      error: 'Configure ao menos uma chave de API no ambiente de hospedagem.'
    });
  }

  const results = await Promise.allSettled(
    configured.map(([key, name]) => ask(name, process.env[key], message, category))
  );

  const statuses = results.map((r, i) => ({
    provider: configured[i][1],
    ok: r.status === 'fulfilled' && !!r.value,
    error: r.status === 'rejected' ? String(r.reason?.message || r.reason) : null
  }));

  const answers = results
    .map((r, i) => ({
      provider: configured[i][1],
      answer: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? String(r.reason?.message || r.reason) : null
    }))
    .filter(x => x.answer);

  if (!answers.length) {
    return res.status(502).json({
      error: 'Os provedores configurados não responderam.',
      statuses
    });
  }

  return res.status(200).json({
    mode: answers.length > 1 ? 'conselho-multi-ia' : 'fallback',
    answers,
    statuses
  });
}

async function ask(name, key, message, category) {
  const prompt = `Você é parte de um conselho empresarial multi-IA. Área: ${category}. Analise a demanda com visão estratégica, evidências, riscos, alternativas e próximos passos. Se a informação precisar ser atualizada, não invente: indique que deve ser verificada por pesquisa/web. Outra IA irá comparar sua análise. Responda em português do Brasil.\n\nDEMANDA:\n${message}`;

  if (name === 'Gemini') {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!r.ok) throw new Error('Gemini HTTP ' + r.status);
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  }

  const url = name === 'DeepSeek'
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';

  const model = name === 'DeepSeek'
    ? 'deepseek-v4-flash'
    : 'openai/gpt-oss-120b';

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: message }
      ]
    })
  });

  if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}
