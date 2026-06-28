/**
 * Registro de parsers por UF. Resolve qual `ParserSefaz` atende um estado e
 * expõe a lista de UFs suportadas — usada pelo reprocessamento retroativo
 * (C2.5) para saber quais cupons pendentes já podem ser processados.
 */

import { UfNaoSuportadaError } from '../erros';
import type { ParserSefaz } from './tipos';

export class RegistroParsers {
  private readonly porUf = new Map<string, ParserSefaz>();

  constructor(parsers: ParserSefaz[]) {
    for (const parser of parsers) {
      this.porUf.set(parser.uf, parser);
    }
  }

  /** Há parser para esta UF? */
  suporta(uf: string): boolean {
    return this.porUf.has(uf);
  }

  /** Resolve o parser da UF ou lança `UfNaoSuportadaError`. */
  resolver(uf: string): ParserSefaz {
    const parser = this.porUf.get(uf);
    if (!parser) {
      throw new UfNaoSuportadaError(uf);
    }
    return parser;
  }

  /** UFs com parser disponível (ordenadas, para logs/telemetria estáveis). */
  ufsSuportadas(): string[] {
    return [...this.porUf.keys()].sort();
  }
}
