/**
 * Helpers compartidos de las suites determinísticas (dedup del boilerplate que
 * vivía copy-pasteado en casi todas: `let passed`/`const failures`/`function
 * check`/footer con "N/M casos OK" + exit 1). Una sola fuente para el harness.
 *
 * `createChecker(name)` devuelve `{ check, done }`:
 *   - `check(cond, note)`: suma un caso OK o registra el fallo (mismo formato
 *     "  ✗ <note>" que antes).
 *   - `done()`: imprime el footer estándar y hace `process.exit(1)` si hubo
 *     fallos. El texto "N/M casos OK" se conserva EXACTO porque run-suites.ts lo
 *     parsea con /(\d+)\s*\/\s*(\d+)\s+casos/ para el resumen agregado del gate.
 *
 * Funciona igual en suites top-level y en las que envuelven todo en `main()`
 * async (basta llamar `done()` al final). No cubre las suites con footer o idiom
 * propios (memory: footer distinto; crisis/moderation: comparación data-driven
 * sin `check()`), que quedan intencionalmente fuera.
 */

export type Checker = {
  /** Registra un caso: OK si `cond`, si no acumula el fallo con su nota. */
  check: (cond: boolean, note: string) => void;
  /** Nº de casos OK hasta el momento (solo lectura conveniente). */
  readonly passed: () => number;
  /** Notas de los fallos acumulados (solo lectura conveniente). */
  readonly failures: () => readonly string[];
  /** Imprime el footer estándar y sale con código 1 si hubo algún fallo. */
  done: () => void;
};

export function createChecker(suiteName: string): Checker {
  let passed = 0;
  const failures: string[] = [];

  return {
    check(cond, note) {
      if (cond) passed += 1;
      else failures.push(`  ✗ ${note}`);
    },
    passed: () => passed,
    failures: () => failures,
    done() {
      const total = passed + failures.length;
      console.log(`\n${suiteName}: ${passed}/${total} casos OK`);
      if (failures.length > 0) {
        console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
        process.exit(1);
      }
      console.log("Todos los casos pasaron.\n");
    },
  };
}
