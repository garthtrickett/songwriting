{
  description = "Songwriter desktop development: pinned Rust, Bun and Tauri libraries";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, rust-overlay, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; overlays = [ rust-overlay.overlays.default ]; };
          lib = pkgs.lib;
          rust = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          bun = import ./nix/bun.nix { inherit pkgs; };
          ffmpeg = import ./nix/ffmpeg.nix { inherit pkgs; };
          nativeLibraries = with pkgs; [ openssl ] ++ lib.optionals stdenv.hostPlatform.isLinux [
            alsa-lib gtk3 webkitgtk_4_1 libsoup_3 libayatana-appindicator xdotool librsvg
            glib-networking gsettings-desktop-schemas stdenv.cc.cc.lib
          ];
        in {
          default = pkgs.mkShell {
            packages = [ rust bun pkgs.pkg-config pkgs.git ffmpeg ];
            SONGWRITER_FFMPEG = "${ffmpeg}/bin/ffmpeg";
            buildInputs = nativeLibraries;
            shellHook = lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              # Bun loads the npm Tauri CLI's native addon; it needs these shared
              # libraries even before Cargo compiles our application.
              export LD_LIBRARY_PATH="${lib.makeLibraryPath nativeLibraries}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
              export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
            '';
          };
        });
    };
}
