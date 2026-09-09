# Pin the upstream binary to .bun-version, retaining nixpkgs' Linux ELF patching
# and macOS signing. Hashes are the upstream release asset SHA-256 digests.
{ pkgs }:
let
  version = pkgs.lib.trim (builtins.readFile ../.bun-version);
  sources = {
    x86_64-linux = { archive = "bun-linux-x64-baseline"; hash = "sha256-xngEDxT+BEDrg503y9DOTAUaMtpygGrJfeamqra/co8="; };
    aarch64-linux = { archive = "bun-linux-aarch64"; hash = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac="; };
    aarch64-darwin = { archive = "bun-darwin-aarch64"; hash = "sha256-kJh6OhbX21VtiGrD1VHnttPt8KHPQ6yu1iLoZ2vh0S8="; };
  };
  source = sources.${pkgs.stdenv.hostPlatform.system};
in
pkgs.bun.overrideAttrs (_: {
  inherit version;
  src = pkgs.fetchurl {
    url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${source.archive}.zip";
    inherit (source) hash;
  };
  sourceRoot = source.archive;
})
