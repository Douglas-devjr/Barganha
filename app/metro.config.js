// Metro configurado para o monorepo (npm workspaces).
// O app importa `@barganha/shared` direto da fonte TS; por isso o Metro precisa
// observar a raiz do monorepo e resolver os node_modules de ambos os níveis.
// Ver: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Observa o app + a raiz do monorepo (para enxergar `shared/`).
//    Preserva os defaults do Expo e acrescenta a raiz do workspace.
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

// 2. Resolve módulos do app e da raiz (hoisting dos workspaces).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
