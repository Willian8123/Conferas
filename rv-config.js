// Ligação com o Supabase (projeto do protótipo de RV).
// A chave "publishable" é pública por natureza: quem protege os dados é a segurança por linha do banco.
window.RV_CONFIG = {
  URL: "https://pgbgyndarmfikyiygmmc.supabase.co",
  KEY: "sb_publishable_py_jFlr3ITkWpWc7CZPjNw_jfzC1onU",
  DOMINIO: "rv.interno",
  // Chave pública dos avisos no celular (push). A chave privada fica só nos Secrets do Supabase.
  VAPID_PUBLICA: "BF73mPGMENYiesSnlKp07liND0nB-NNOWv9ifhnBEm4sMFuHtDcEjdMToE_L1lBHsQRQHObk485us6DOM2E3Pqs",
  FUNCAO_AVISO: "notificar-recontagem"
};
