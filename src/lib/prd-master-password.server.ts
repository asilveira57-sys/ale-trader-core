// Senha mestra do portão de conta REAL.
// Falha FECHADA: sem B3_PRD_MASTER_PASSWORD_HASH configurado, nada é liberado.
// Formato do hash: scrypt$<salt_hex>$<derivado_hex>
export async function assertMasterPassword(password: string) {
  const stored = process.env["B3_PRD_MASTER_PASSWORD_HASH"];
  if (!stored || !stored.trim()) {
    throw new Error(
      "Senha mestra não configurada: a variável B3_PRD_MASTER_PASSWORD_HASH não existe. Nada foi liberado.",
    );
  }

  const { scrypt, timingSafeEqual } = await import("node:crypto");

  const parts = stored.trim().split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) {
    throw new Error("Senha mestra não configurada corretamente (formato de hash inválido). Nada foi liberado.");
  }

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");

  const derived: Buffer = await new Promise((resolve, reject) => {
    scrypt(password, salt, expected.length, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });

  if (derived.length !== expected.length || !timingSafeEqual(derived, expected)) {
    throw new Error("senha mestra inválida");
  }
}
