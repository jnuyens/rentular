// Ambient module shims for third-party packages that ship no type declarations.
// nordigen-node has no bundled types; it is used only via a thin wrapper in
// lib/bankAccountData.ts, so a permissive declaration is sufficient.
declare module "nordigen-node";
