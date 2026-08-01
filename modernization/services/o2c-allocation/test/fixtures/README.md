# Golden Fixtures — O2C Parity Suite

Each `.json` file in this directory defines an Oracle-era golden dataset for one
O2C posting scenario. The parity harness (`test/parity-suite.test.js`)
auto-discovers all fixtures on each run — **no code changes needed** to add a
new scenario.

## Fixture schema

```jsonc
{
  "scenario": "short-kebab-name",
  "description": "Human-readable description of the scenario",
  "allocationId": 600,            // C_AllocationHdr ID to post
  "seedSql": [                    // Optional: SQL to seed scenario data (idempotent)
    "INSERT INTO ... ON CONFLICT DO NOTHING"
  ],
  "expected": {
    "totalDebit": 1000.00,        // Sum of all DR in accounting currency
    "totalCredit": 1000.00,       // Sum of all CR in accounting currency
    "balanced": true,             // DR == CR
    "lines": [                    // Expected Fact_Acct lines aggregated by acctType
      { "acctType": "UnallocatedCash", "dr": 980.00, "cr": 0.00 },
      { "acctType": "DiscountExp",     "dr": 20.00,  "cr": 0.00 },
      { "acctType": "Receivable",      "dr": 0.00,   "cr": 1000.00 }
    ]
  }
}
```

## Adding a new scenario

1. Create a new `.json` file following the schema above.
2. If the scenario needs seed data not in `src/sql/seed.sql`, add idempotent
   `INSERT ... ON CONFLICT DO NOTHING` statements to `seedSql`.
3. Run `npm test` — the harness picks up the new fixture automatically.

## Valid `acctType` values

- `Receivable` — AR settled
- `UnallocatedCash` — cash received
- `DiscountExp` — payment discount
- `WriteOff` — bad debt write-off
- `RealizedGain` — FX gain on settlement
- `RealizedLoss` — FX loss on settlement
