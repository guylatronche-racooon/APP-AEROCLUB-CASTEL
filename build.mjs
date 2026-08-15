// Le build de production doit toujours refléter les fichiers locaux du dépôt.
// La logique de copie et de reconstitution des éventuels actifs encodés reste
// centralisée dans scripts/build.mjs pour éviter deux procédures divergentes.
await import('./scripts/build.mjs');
