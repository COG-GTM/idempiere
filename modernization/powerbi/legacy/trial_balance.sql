-- Trial Balance (L8N2-106): PostgreSQL port of org.idempiere.acct.report.TrialBalance.
-- Fixed parameters (story example): AD_Client_ID=11, C_AcctSchema_ID=101, PostingType='A',
-- DateAcct 2026-07-01 .. 2026-09-30, no Org / Account / BPartner filter.
--
-- Mirrors:
--   prepare()           m_parameterWhere: C_AcctSchema_ID=? AND PostingType='A' (budget 'B' excluded)
--   setDateAcct()       p_DateAcct_From / p_DateAcct_To from the DateAcct range parameter
--   createBalanceLine() beginning balance (LevelNo 0): SUM(AmtAcctDr), SUM(AmtAcctCr) with
--                       DateAcct < p_DateAcct_From; for accounts where !isBalanceSheet() it also
--                       requires DateAcct >= MPeriod.getFirstInYear(p_DateAcct_From).StartDate
--   createDetailLines() period lines (LevelNo 10): DateAcct >= From AND TRUNC(DateAcct) <= To,
--                       AmtAcctBalance = AmtAcctDr - AmtAcctCr
--   doIt()              DELETE of accounts whose beginning balance is 0 and that have no detail lines
-- T_TrialBalance rows are summarised per account (the report's account grouping).
WITH params AS (
    SELECT DATE '2026-07-01' AS date_from, DATE '2026-09-30' AS date_to
),
first_in_year AS (               -- MPeriod.getFirstInYear(ctx, p_DateAcct_From, AD_Org_ID)
    SELECT MIN(p.startdate) AS startdate
    FROM c_period p
    WHERE p.c_year_id = (SELECT cp.c_year_id FROM c_period cp, params
                         WHERE params.date_from BETWEEN cp.startdate AND cp.enddate)
),
fa AS (                          -- Fact_Acct WHERE AD_Client_ID=? AND m_parameterWhere
    SELECT f.*
    FROM fact_acct f
    WHERE f.ad_client_id = 11
      AND f.c_acctschema_id = 101
      AND f.postingtype = 'A'
),
beginning AS (                   -- createBalanceLine()
    SELECT fa.account_id,
           COALESCE(SUM(fa.amtacctdr), 0) - COALESCE(SUM(fa.amtacctcr), 0) AS amtacctbalance
    FROM fa
    JOIN c_elementvalue ev ON ev.c_elementvalue_id = fa.account_id
    CROSS JOIN params
    CROSS JOIN first_in_year fy
    WHERE fa.dateacct < params.date_from
      AND (ev.isbalancesheet = 'Y' OR fa.dateacct >= fy.startdate)
    GROUP BY fa.account_id
),
detail AS (                      -- createDetailLines()
    SELECT fa.account_id,
           SUM(fa.amtacctdr) AS amtacctdr,
           SUM(fa.amtacctcr) AS amtacctcr
    FROM fa
    CROSS JOIN params
    WHERE fa.dateacct >= params.date_from
      AND fa.dateacct <= params.date_to
    GROUP BY fa.account_id
)
SELECT ev.value                                       AS account_value,
       ev.name                                        AS account_name,
       ev.accounttype_name                            AS account_type,
       COALESCE(b.amtacctbalance, 0)                  AS beginning_balance,
       COALESCE(d.amtacctdr, 0)                       AS period_debit,
       COALESCE(d.amtacctcr, 0)                       AS period_credit,
       COALESCE(b.amtacctbalance, 0)
         + COALESCE(d.amtacctdr, 0) - COALESCE(d.amtacctcr, 0) AS ending_balance
FROM c_elementvalue ev
LEFT JOIN beginning b ON b.account_id = ev.c_elementvalue_id
LEFT JOIN detail d    ON d.account_id = ev.c_elementvalue_id
WHERE d.account_id IS NOT NULL                        -- doIt(): keep accounts with detail lines
   OR (b.account_id IS NOT NULL AND b.amtacctbalance <> 0)  -- or a non-zero beginning balance
ORDER BY ev.value;
