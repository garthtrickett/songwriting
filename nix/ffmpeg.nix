{ pkgs }:
let spec = builtins.fromJSON (builtins.readFile ../scripts/desktop/ffmpeg.json);
in pkgs.stdenv.mkDerivation {
  pname = "songwriter-ffmpeg";
  version = spec.version;
  src = pkgs.fetchurl {
    url = "https://ffmpeg.org/releases/ffmpeg-${spec.version}.tar.xz";
    sha256 = spec.sourceSha256;
  };
  nativeBuildInputs = [ pkgs.pkg-config ];
  configureFlags = spec.flags;
  enableParallelBuilding = true;
  buildFlags = [ "ffmpeg" ];
  installPhase = ''
    runHook preInstall
    install -Dm755 ffmpeg "$out/bin/ffmpeg"
    install -Dm644 COPYING.LGPLv2.1 "$out/share/songwriter-ffmpeg/COPYING.LGPLv2.1"
    install -Dm644 LICENSE.md "$out/share/songwriter-ffmpeg/LICENSE.md"
    install -Dm644 "$src" "$out/share/songwriter-ffmpeg/ffmpeg-${spec.version}.tar.xz"
    runHook postInstall
  '';
}
