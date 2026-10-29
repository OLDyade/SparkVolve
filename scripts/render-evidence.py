"""Render the documented experiment directly from its machine-readable evidence.

Run: python3 -m pip install -r scripts/requirements-figures.txt
     python3 scripts/render-evidence.py
No model calls, benchmark runs or synthetic scores are involved.
"""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

root = Path(__file__).resolve().parents[1]
source = root / 'docs/evidence/2026-10-27-continuous-acceptance.json'
evidence = json.loads(source.read_text())
search = evidence['search']['candidates']
validation = evidence['validation']['comparison']['results']
selected = next(c for c in search if c['digest'] == evidence['validation']['selection']['candidate'])
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'svg.hashsalt': 'sparkvolve-evidence', 'axes.titleweight': 'bold'})
fig, axes = plt.subplots(1, 2, figsize=(12, 5.8), gridspec_kw={'wspace': .55})
fig.patch.set_facecolor('#ffffff')
blue, gray, rust = '#3157c8', '#60718b', '#b84b34'
for ax in axes:
    ax.set_axisbelow(True)
    ax.xaxis.grid(True, color='#e6eaf0', linewidth=.8)
    ax.set_xlim(0, 1.18)
    ax.set_xticks([0, .25, .5, .75, 1])
    ax.xaxis.set_major_formatter(PercentFormatter(1))
    ax.tick_params(axis='both', length=0, labelcolor='#334155', pad=9)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_xlabel('Full-denominator mean', color='#475569', labelpad=12)

labels = ['Baseline'] + [f'Mutation {c["ordinal"]}' for c in search[1:]]
axes[0].barh(range(len(search)), [c['mean'] for c in search], height=.48,
             color=[blue] + [gray] * (len(search)-1))
axes[0].set_yticks(range(len(search)), labels)
axes[0].invert_yaxis()
axes[0].set_title('01  Continuous search', loc='left', pad=24, color='#16223a')
for i, candidate in enumerate(search):
    axes[0].text(candidate['mean']+.025, i, f'{candidate["mean"]:.1%}', va='center', color='#16223a')

labels = []
for arm in validation:
    scored = sum(sample['phase'] == 'scored' for sample in arm['samples'])
    label = 'Baseline' if arm['id'] == 'baseline' else f'Mutation {selected["ordinal"]}'
    labels.append(f'{label}\n{scored}/{len(arm["samples"])} scored')
axes[1].barh(range(len(validation)), [arm['mean'] for arm in validation], height=.38, color=[blue, rust])
axes[1].set_yticks(range(len(validation)), labels)
axes[1].invert_yaxis()
axes[1].set_ylim(1.7, -.7)
axes[1].set_title('02  Paired validation', loc='left', pad=24, color='#16223a')
for i, arm in enumerate(validation):
    axes[1].text(arm['mean']+.025, i, f'{arm["mean"]:.3%}', va='center', color='#16223a')

candidate = next(arm for arm in validation if arm['id'] == 'candidate')
failed = sum(s['phase'] == 'execution_failed' for s in candidate['samples'])
cancelled = sum(s['phase'] == 'cancelled' for s in candidate['samples'])
fig.suptitle('Real experiments. Complete denominators.', x=.06, y=.98, ha='left', fontsize=19, fontweight='bold', color='#16223a')
fig.text(.06, .895, f'{evidence["date"]} · {evidence["model"]["model"]} · Synthetic business workbooks', color='#60718b', fontsize=10)
fig.text(.06, .12, f'Search: {search[0]["denominator"]} tasks/version. Validation: {len(validation[0]["samples"])} runs/arm. Selected: M{selected["ordinal"]} ({selected["digest"][:8]}).', color='#475569', fontsize=10)
fig.text(.06, .075, f'Validation candidate: {failed} transport failure, {cancelled} cancellations; all remain in the mean.', color='#475569', fontsize=10)
fig.text(.06, .03, 'No stable quality gain established. Results are not official SpreadsheetBench scores.', color=rust, fontsize=10)
fig.subplots_adjust(top=.77, bottom=.26, left=.13, right=.96)
output = root / 'docs/assets'
output.mkdir(exist_ok=True)
fig.savefig(output/'experiment-results.svg', metadata={'Date': None, 'Description': str(source.relative_to(root))})
fig.savefig(output/'experiment-results.png', dpi=180)
print(output/'experiment-results.svg')
