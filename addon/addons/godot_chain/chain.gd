extends Node

## Punto de entrada del addon. Autoload registrado por `plugin.gd`.
##
## Esqueleto: la API real (`create_item`, `grant`, `transfer`, `inventory`) llega en el
## bloque 6 del plan de trabajo, contra el contrato congelado en `docs/http-contract.md`.

const VERSION := "0.1.0"
