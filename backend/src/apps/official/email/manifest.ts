import type { AppDefinition } from '../../types.js'

export const manifest: AppDefinition = {
  key: 'email',
  version: '1.0.0',
  source: 'system',
  name: 'E-mail (SMTP)',
  description: 'Enviar e-mails pelas rotinas usando seu próprio servidor SMTP.',
  icon: 'email',
  categories: ['comunicação'],
  auth: {
    kind: 'basic',
    fields: [
      { key: 'host', label: 'Servidor SMTP', placeholder: 'smtp.seuprovedor.com', required: true, secret: false },
      { key: 'port', label: 'Porta', placeholder: '587', required: true, secret: false },
      { key: 'secure', label: 'Conexão segura (SSL)', required: false, secret: false },
      { key: 'user', label: 'Usuário', required: true, secret: false },
      { key: 'pass', label: 'Senha', required: true, secret: true },
      { key: 'from', label: 'Remetente', placeholder: 'nome@seudominio.com', required: true, secret: false },
    ],
  },
  allowedDomains: [],
  supportsMultipleConnections: true,
  actions: [],
  status: 'published',
  dataAccess: ['Envia e-mails pela sua conta SMTP.'],
  storageNote: 'A senha fica criptografada e nunca é reexibida.',
  disconnectNote: 'Rotinas que entregam por este e-mail param de enviar. O histórico de entregas é preservado.',
}
