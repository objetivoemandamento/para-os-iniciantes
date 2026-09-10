# Central IA Empresarial

Projeto para concentrar ferramentas de IA por área de trabalho e oferecer uma conversa empresarial com roteamento para provedores de IA.

## O que já existe

- 15 categorias e 15 ferramentas, sem repetição.
- Interface visual em `docs/index.html`.
- Catálogo detalhado em `docs/IA_EMPRESARIAL.md`.
- Backend em `api/chat.js`.
- Roteamento por categoria e fallback entre provedores.
- Chaves protegidas por variáveis de ambiente.

## Ativação da conversa com IA

O backend aceita `POST /api/chat` com:

```json
{
  "message": "Analise este problema comercial...",
  "category": "Raciocínio e análise",
  "history": []
}
```

Configure no ambiente de hospedagem:

- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- opcional: `OPENROUTER_MODEL` (padrão: `openrouter/free`)

**Nunca** coloque chaves reais no HTML, JavaScript do navegador ou neste repositório. Use as variáveis de ambiente da plataforma de deploy.

## Deploy

A pasta `api/` foi estruturada para um ambiente serverless compatível com funções Node. O arquivo `docs/index.html` é a interface. Em um deploy que publique o projeto na raiz, mantenha `/api/chat` acessível pelo mesmo domínio da interface.

## Observação importante

As 15 ferramentas continuam disponíveis como atalhos especializados. Nem todas oferecem uma API pública simples ou gratuita para serem incorporadas diretamente no mesmo chat. Por isso, o projeto separa **ferramenta especializada** de **provedor de conversa integrado**, evitando simular integrações que não existem.
