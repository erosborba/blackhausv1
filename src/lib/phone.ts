/**
 * Normalização de telefones brasileiros.
 *
 * Problema: JIDs do WhatsApp/Baileys às vezes omitem o "9" de celulares (55 DD 9
 * XXXXXXXX → 55 DD XXXXXXXX). É um resquício da era pré-2012 de numeração
 * móvel brasileira. Resultado: o mesmo número pode aparecer como
 * "5541997932996" (13 dígitos, com 9) OU "554197932996" (12 dígitos, sem o 9).
 *
 * Usamos `brPhoneVariants(phone)` pra gerar as duas formas e checar/buscar por
 * ambas em caches e queries.
 */

export function brPhoneVariants(phone: string): string[] {
  if (!phone || !phone.startsWith("55") || phone.length < 12) return [phone];
  const ddi = phone.slice(0, 2); // "55"
  const ddd = phone.slice(2, 4); // DDD 2 dígitos
  const rest = phone.slice(4);
  // Celular brasileiro: pós-DDD tem 9 dígitos começando com 9.
  if (rest.length === 9 && rest.startsWith("9")) {
    // tem o 9 → oferece também a versão sem
    return [phone, `${ddi}${ddd}${rest.slice(1)}`];
  }
  // Formato antigo (8 dígitos pós-DDD): oferece também a versão com 9.
  if (rest.length === 8) {
    return [phone, `${ddi}${ddd}9${rest}`];
  }
  return [phone];
}

/** Forma canônica preferida: BR celular sempre com o 9. */
export function brPhoneCanonical(phone: string): string {
  if (!phone || !phone.startsWith("55") || phone.length < 12) return phone;
  const ddi = phone.slice(0, 2);
  const ddd = phone.slice(2, 4);
  const rest = phone.slice(4);
  if (rest.length === 8) return `${ddi}${ddd}9${rest}`;
  return phone;
}
