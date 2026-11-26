# ADR-0125: Stage names are an organisation overlay on a fixed stored key

Date: 26 November 2026. Status: accepted by Director ruling (#2906, slice 1).

Organisations call their sales and project stages by their own words. The stored stage (`project_status`) stays the fixed key that rules, transitions, filters, reports and integrations read. An organisation may store one optional name per language for each stage; a blank name means the shipped wording. One resolver turns a key into its displayed name, and every screen reads through it.

Renaming therefore changes no record and no rule, and it reverses by clearing the name. Adding, removing or reordering stages is a different decision with different consequences (transitions, probabilities, history) and is not covered here.

Rejected: free-text stages per organisation (every rule keyed on a stage would need a mapping, and history would lose meaning); per-organisation translation files (a deploy for a wording change).
