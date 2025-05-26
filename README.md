# Sistema de Upload de PDF

Este é um sistema web para upload e processamento de arquivos PDF, integrado com n8n para processamento assíncrono.

## Funcionalidades

- Autenticação de usuários
- Upload de arquivos PDF com barra de progresso
- Histórico de uploads com status de processamento
- Integração com n8n para processamento assíncrono
- Interface moderna e responsiva com Tailwind CSS

## Tecnologias Utilizadas

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- NextAuth.js
- React Query
- Axios
- Zod (validação de formulários)

## Pré-requisitos

- Node.js 18+
- npm ou yarn
- n8n instalado e configurado

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Copie o arquivo `.env.local.example` para `.env.local` e configure as variáveis de ambiente:
   ```bash
   cp .env.local.example .env.local
   ```
4. Configure as variáveis de ambiente no arquivo `.env.local`:
   - `NEXTAUTH_URL`: URL base da aplicação
   - `NEXTAUTH_SECRET`: Chave secreta para o NextAuth (gere uma chave segura em produção)
   - `N8N_WEBHOOK_URL`: URL do webhook do n8n para processamento de PDFs

## Desenvolvimento

Para iniciar o servidor de desenvolvimento:

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:3000`.

## Produção

Para construir a aplicação para produção:

```bash
npm run build
```

Para iniciar a aplicação em produção:

```bash
npm start
```

## Integração com n8n

O sistema está configurado para enviar os arquivos PDF para um webhook do n8n. O n8n deve estar configurado para:

1. Receber o arquivo PDF via webhook
2. Processar o arquivo conforme necessário
3. Atualizar o status do processamento no banco de dados
4. Notificar a aplicação sobre a conclusão do processamento

## Estrutura do Projeto

```
src/
  ├── app/                    # Rotas e páginas da aplicação
  │   ├── api/               # Rotas da API
  │   ├── dashboard/         # Página do dashboard
  │   └── login/            # Página de login
  ├── components/            # Componentes React
  ├── lib/                   # Utilitários e configurações
  ├── providers/            # Providers React (Auth, Query)
  └── types/                # Definições de tipos TypeScript
```

## Contribuição

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## Licença

Este projeto está licenciado sob a licença MIT.
