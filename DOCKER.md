# 🐳 Deploy Docker - Digital Ocean + Easypanel

Documentação para fazer deploy da aplicação de Upload de PDF na Digital Ocean usando Easypanel.

## 📋 Pré-requisitos

- Digital Ocean Droplet com Easypanel instalado
- Repositório Git configurado
- Variáveis de ambiente configuradas

## 🚀 Deploy no Easypanel

### 1. **Conectar Repositório**

No Easypanel, adicione um novo serviço e conecte este repositório Git.

### 2. **Configurações do Serviço**

```yaml
Nome: upload-app
Tipo: Application
Método de Build: Dockerfile
```

### 3. **Variáveis de Ambiente**

Configure as seguintes variáveis no Easypanel:

```env
# NextAuth
NEXTAUTH_URL=https://seu-dominio.com
NEXTAUTH_SECRET=sua-chave-secreta-aqui

# n8n
N8N_WEBHOOK_URL=https://n8n-n8n.ugu7yu.easypanel.host/webhook/upload-arquivo

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://syhmnoytyrbiwxtonicn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
SUPABASE_JWT_SECRET=sua-jwt-secret
```

### 4. **Configurações de Porta**

- **Porta do Container**: 3000
- **Porta Pública**: 80 ou 443 (HTTPS)

## 🔧 Comandos Docker Locais

### Build da Imagem

```bash
docker build -t upload-app .
```

### Executar Container

```bash
docker run -p 3000:3000 \
  -e NEXTAUTH_URL=http://localhost:3000 \
  -e NEXTAUTH_SECRET=sua-chave-aqui \
  upload-app
```

### Docker Compose (Teste Local)

```bash
# Iniciar
docker-compose up -d

# Parar
docker-compose down

# Logs
docker-compose logs -f
```

## 📊 Monitoramento

### Health Check

A aplicação possui um endpoint de health check:

```
GET /api/health
```

Resposta esperada:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-25T10:30:00.000Z",
  "service": "upload-app",
  "version": "1.0.0"
}
```

## 🔍 Troubleshooting

### Container não inicia

1. Verifique as variáveis de ambiente
2. Confirme se a porta 3000 está disponível
3. Verifique os logs: `docker logs container-id`

### Build falha

1. Verifique se `package.json` está correto
2. Confirme dependências no `package-lock.json`
3. Limpe cache: `docker system prune -a`

### Aplicação não responde

1. Teste health check: `curl http://localhost:3000/api/health`
2. Verifique conectividade com Supabase
3. Confirme webhook do n8n

## 📝 Notas Importantes

- **Node.js**: Versão 18 Alpine
- **Multi-stage Build**: Otimizado para produção
- **Standalone Output**: Habilitado no Next.js
- **Security**: Container roda como usuário não-root
- **Size**: Imagem otimizada ~150MB

## 🌐 URLs Importantes

- **App**: `https://seu-dominio.com`
- **Health**: `https://seu-dominio.com/api/health`
- **Dashboard**: `https://seu-dominio.com/dashboard`

---

### 🚀 Deploy Rápido no Easypanel

1. **Criar novo serviço** no Easypanel
2. **Conectar repositório** Git
3. **Configurar variáveis** de ambiente
4. **Deploy** automático será iniciado
5. **Acessar** aplicação no domínio configurado

✅ **Pronto para produção!**
