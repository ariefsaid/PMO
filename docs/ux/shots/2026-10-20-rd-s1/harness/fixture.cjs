// §0.1 client-shaped synthetic fixture (invented names/values). IDR org, IDR+USD close-outs.
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAMES = [
  'Pembangunan Fasilitas Pengolahan Air Limbah Terpadu Kawasan Industri Cikarang Tahap II',
  'Rehabilitasi Jaringan Pipa Distribusi Gas Alam Wilayah Jawa Barat Bagian Selatan',
  'Pengadaan dan Pemasangan Sistem Kelistrikan Gardu Induk 150kV Lot 3',
  'Jasa Konsultansi Pengawasan Proyek Jalan Tol Ruas Semarang–Demak Seksi 1B',
  'Perawatan Berkala Instalasi Mekanikal Elektrikal Gedung Perkantoran Terpadu',
  'Studi Kelayakan dan Desain Rinci Dermaga Curah Kering Pelabuhan Patimban',
];
const CONTRACTS = [63400000000, 48215000000, 21870500000, 15300000000, 7925000000, 4180000000];
const SPENT = [24812225000, 17402000000, 9115750000, 4310000000, 2120800000, 652000000];
const top = NAMES.map((name, i) => ({
  id: uuid(i + 1), name, client_name: ['PT Graha Lestari Nusantara', 'PT Tirta Rekayasa Mandiri', 'PT Bumi Arta Perkasa', 'PT Sinar Karya Utama', 'PT Mitra Teknik Persada', 'PT Samudra Inti Logistik'][i],
  contract_value: CONTRACTS[i], currency: 'IDR', budget: null, spent: SPENT[i], actual_currency: 'IDR', actual_complete: false,
  budget_currency: null, actual_coverage_count: 144, actual_coverage_total: 150, realized_margin: null, status: 'Ongoing Project',
}));
const executive = {
  active_projects: 6,
  total_contract_value: 160890500000,
  total_contract_value_by_currency: { IDR: 160890500000 },
  on_hand_value: null,
  on_hand_value_by_currency: [
    { currency: 'IDR', contract_value: 373530500000, actual_known: 58412775000, contract_remaining: 315117725000, actual_coverage_count: 144, actual_coverage_total: 150, realized_margin_known: null, unknown_projects: 20 },
    { currency: 'USD', contract_value: 3412800, actual_known: null, contract_remaining: null, actual_coverage_count: null, actual_coverage_total: null, realized_margin_known: null, unknown_projects: 5 },
  ],
  on_hand_contract_remaining: null,
  on_hand_realized_margin: null,
  on_hand_realized_margin_by_currency: [{ currency: 'IDR', known_amount: null, unknown_projects: 20 }, { currency: 'USD', known_amount: null, unknown_projects: 5 }],
  on_hand_actual_known: 58412775000,
  on_hand_actual_project_count: 6,
  on_hand_actual_project_total: 25,
  on_hand_actual_coverage_count: 144,
  on_hand_actual_coverage_total: 150,
  on_hand_margin: null,
  pipeline_total_value: 190900000000,
  pipeline_total_value_by_currency: [{ currency: 'IDR', total_value: 190900000000, weighted_value: 75185000000, forecast_margin: null, no_active_budget: 19 }],
  pipeline_weighted_value: 75185000000,
  pipeline_projected_margin: null,
  projects_at_risk: 0,
  projects_by_status: [
    { status: 'Leads', count: 7 }, { status: 'PQ Submitted', count: 4 }, { status: 'Quotation Submitted', count: 5 },
    { status: 'Tender Submitted', count: 3 }, { status: 'Ongoing Project', count: 6 }, { status: 'Close Out', count: 19 }, { status: 'Loss Tender', count: 1 },
  ],
  procurements_by_status: [{ status: 'Draft', count: 2 }, { status: 'Approved', count: 1 }],
  top_projects: top,
};
const winRate = {
  wins_count: 19, losses_count: 1, declined_count: 0, wins_value: null, losses_value: null, win_rate_count: 0.95, win_rate_value: null,
  value_by_currency: [
    { currency: 'IDR', wins_value: 212640000000, losses_value: 9750000000, win_rate_value: 0.9561 },
    { currency: 'USD', wins_value: 3412800, losses_value: 0, win_rate_value: 1 },
  ],
};
const stageDefs = [
  ['Leads', 7, 38200000000, 0.1], ['PQ Submitted', 4, 26500000000, 0.25], ['Quotation Submitted', 5, 54900000000, 0.4],
  ['Tender Submitted', 3, 71300000000, 0.6], ['Negotiation', 0, 0, 0.8],
];
let n = 100;
const pipelineProjects = [];
for (const [status, count, total, p] of stageDefs) {
  for (let i = 0; i < count; i++) {
    const v = Math.round(total / count / 1000) * 1000;
    pipelineProjects.push({ id: uuid(++n), name: `${NAMES[n % 6].split(' ').slice(0, 6).join(' ')} — Paket ${n}`, pmo_project_number: `PMO-2025-${String(n).padStart(4, '0')}`,
      code: `PO/GLN/2025/0${n}-REV.03`, client_name: 'PT Graha Lestari Nusantara', end_client_name: null, status, contract_value: v, currency: 'IDR',
      tax_treatment: 'exclusive', tax_rate: 0.11, win_probability: p, last_update: '2026-09-02T03:00:00Z', pm_name: 'Rangga Wicaksono' });
  }
}
const pipeline = {
  stages: stageDefs.map(([status, count, total, p]) => ({ status, count, total_value: total, win_probability: p, weighted_value: Math.round(total * p) })),
  projects: pipelineProjects,
};
const pmProjects = top.map((t, i) => ({ ...t, contract_remaining: t.contract_value - t.spent, realized_margin_pct: null }));
module.exports = { executive, winRate, pipeline, pmProjects };
