-- Foundation parity check: actual debits and credits per accounting period.
-- Mirrors the PostingType/C_AcctSchema filter every iDempiere accounting report
-- applies (TrialBalance.java m_parameterWhere: "C_AcctSchema_ID=? ... AND PostingType='A'").
SELECT p.name                         AS period_name,
       COALESCE(SUM(f.amtacctdr), 0)  AS debit,
       COALESCE(SUM(f.amtacctcr), 0)  AS credit
FROM c_period p
JOIN fact_acct f ON f.c_period_id = p.c_period_id
WHERE f.c_acctschema_id = 101
  AND f.postingtype = 'A'
GROUP BY p.name, p.periodsort
ORDER BY p.periodsort;
