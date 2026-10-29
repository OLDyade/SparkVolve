"""Public business task families with separate, deterministic development/validation inputs.

This generator defines a reproducible research example, not an official benchmark.
Expected numbers are generated independently of model-produced formulas.
"""
import json
import shutil
import sys
from pathlib import Path
from openpyxl import Workbook
from openpyxl.comments import Comment

root = Path(sys.argv[1])
split = sys.argv[2]
if split not in ('development', 'validation', 'reuse'):
    raise ValueError('split must be development, validation or reuse')
root.mkdir()
shift = {'development': 0, 'validation': 137, 'reuse': 283}[split]
tasks = []

def emit(name, rows, expected, instruction, notes):
    public = root / 'inputs' / name
    evaluation = root / 'evaluation' / name
    public.mkdir(parents=True)
    evaluation.mkdir(parents=True)
    wb = Workbook()
    ws = wb.active
    ws.title = 'Model'
    for row in rows:
        ws.append(row)
    for cell, text in notes.items():
        ws[cell].comment = Comment(text, 'Public business specification')
    wb.save(public / 'source.xlsx')
    (evaluation / 'expected.json').write_text(json.dumps([
        {'sheet': 'Model', 'cell': cell, 'value': value} for cell, value in expected.items()
    ]))
    shutil.copyfile(Path(__file__).with_name('grade.py'), evaluation / 'grade.py')
    tasks.append({
        'id': name, 'input': f'inputs/{name}', 'evaluation': f'evaluation/{name}',
        'prompt': 'Complete /input/source.xlsx using Excel formulas. ' + instruction +
        ' Preserve all original inputs, labels, units and intentional blanks. Read original comments. '
        'Deliver /workspace/result.xlsx; an independent engine recalculates formulas. Python openpyxl and LibreOffice are installed.'
    })

years = [2024, 2025, 2026, 2027]
revenue = [900 + shift, 1150 + shift, 1300 + shift, 1480 + shift]
ebt = [180 + shift/5, 225 + shift/5, 260 + shift/5, 290 + shift/5]
expense = [25, 30, 42, 48]
gain = [16, 20, 12, 24]
tax = [39, 47, 58, 62]
expense_rate = [.20, .25, .18, .22]
gain_rate = [.10, .15, .20, .12]
expected = {}
for i, col in enumerate('BCDE'):
    adjusted = ebt[i] + expense[i] - gain[i]
    normalized_tax = tax[i] + expense[i]*expense_rate[i] - gain[i]*gain_rate[i]
    expected.update({f'{col}10': adjusted, f'{col}11': normalized_tax,
                     f'{col}12': adjusted-normalized_tax, f'{col}13': (adjusted-normalized_tax)/revenue[i]})
emit('normalization', [
    ['Metric', *years], ['Revenue', *revenue], ['Reported EBT', *ebt],
    ['Non-recurring expense', *expense], ['Non-recurring gain', *gain],
    ['Reported tax expense', *tax], ['Expense adjustment tax rate', *expense_rate],
    ['Gain adjustment tax rate', *gain_rate], [''], ['Normalized EBT'],
    ['Normalized tax expense'], ['Normalized net profit'], ['Normalized net margin'],
], expected,
    'For every displayed year, normalize reported results by removing non-recurring expenses and gains. '
    'Begin with reported tax expense; each adjustment tax rate applies only to its own adjustment. '
    'Fill all four normalized metric rows for all years.',
    {'A7': 'This rate applies to the expense adjustment only, not total EBT.',
     'A8': 'This rate applies to the gain adjustment only; removing a gain removes its associated tax.'})

units = [120 + shift, 90 + shift, 210 + shift]
prices = [35, 58, 22]
costs = [19, 31, 15]
expected = {}
for i, row in enumerate(range(3,6)):
    sales = units[i]*prices[i]
    gross = units[i]*(prices[i]-costs[i])
    expected.update({f'E{row}':sales/1000, f'F{row}':gross/1000, f'G{row}':gross/sales})
sales = sum(u*p for u,p in zip(units,prices))
gross = sum(u*(p-c) for u,p,c in zip(units,prices,costs))
expected.update({'B6':sum(units),'E6':sales/1000,'F6':gross/1000,'G6':gross/sales})
emit('weighted-portfolio', [
    ['Quarterly portfolio'], ['Segment','Units','Price / unit ($)','Cost / unit ($)','Revenue ($000)','Gross profit ($000)','Gross margin'],
    ['North',units[0],prices[0],costs[0]], ['Central',units[1],prices[1],costs[1]],
    ['South',units[2],prices[2],costs[2]], ['Total'],
], expected,
    'Fill each segment revenue, gross profit and margin. Fill total units, revenue, gross profit and the portfolio margin. '
    'Total price and total cost per unit cells are intentionally blank; do not fill them.',
    {'G6':'Portfolio margin is total gross profit divided by total revenue. Segment margins have different revenue weights.',
     'E2':'Input prices are dollars per unit; displayed revenue and gross profit must be thousands of dollars.'})

principal = 1200 + shift
rates = [.08,.07,.06,.05]
expected = {}
opening = principal
for i,col in enumerate('BCDE'):
    amort = principal/4
    interest = opening*rates[i]
    closing = opening-amort
    expected.update({f'{col}6':opening,f'{col}7':amort,f'{col}8':interest,f'{col}9':amort+interest,f'{col}10':closing})
    opening = closing
emit('debt-rollforward', [
    ['Metric',1,2,3,4], ['Original principal',principal], ['Amortization years',4],
    ['Annual interest rate',*rates], [''], ['Opening balance'], ['Principal repayment'],
    ['Interest expense'], ['Total cash debt service'], ['Closing balance'],
],expected,
    'Build the four-year debt schedule. Repay equal principal installments each year, based on original principal. '
    'Interest uses the same-year opening balance and rate. Fill all five schedule rows for every year.',
    {'A7':'Equal principal installments, not an annuity and not a percentage of remaining balance.',
     'A8':'Interest is based on the opening balance; payment occurs at year end.'})

base_revenue = 1000 + shift
requested_growth = [.10,.08,.06]
requested_margin = [.25,.28,.30]
base_growth = [.03,.03,.03]
base_margin = [.18,.18,.18]
expected = {}
prior = base_revenue
for i,col in enumerate('BCD'):
    forecast = prior*(1+requested_growth[i])
    profit = forecast*requested_margin[i]
    expected.update({f'{col}9':forecast,f'{col}10':profit})
    prior = forecast
expected.update({'D12':expected['D10']*7.5,'D13':expected['D10']*7.5-260+80})
emit('scenario-valuation',[
    ['Metric',2025,2026,2027], ['Historical revenue',base_revenue],
    ['Base growth',*base_growth], ['Requested case growth',*requested_growth],
    ['Base EBITDA margin',*base_margin], ['Requested case EBITDA margin',*requested_margin],
    ['Exit EBITDA multiple',None,None,7.5], [''], ['Forecast revenue'], ['Forecast EBITDA'],
    [''], ['Exit enterprise value'], ['Exit equity value'], ['Exit debt',None,None,260], ['Exit cash',None,None,80],
],expected,
    'Use the requested case to fill all forecast revenues and EBITDA. Then calculate exit enterprise and equity value '
    'in the final year only. Earlier-year exit value cells are intentionally blank.',
    {'A2':'Historical revenue precedes the first displayed forecast year.',
     'A4':'This is the requested scenario, distinct from the base case.',
     'A13':'Equity value = enterprise value minus exit debt plus exit cash.'})

(root/'tasks.json').write_text(json.dumps(tasks,indent=2))
(root/'dataset-card.json').write_text(json.dumps({
    'name':'Public business mechanisms', 'split':split, 'tasks':len(tasks),
    'source':'Programmatically authored synthetic workbooks; no benchmark or customer inputs',
    'relationship':'Validation changes numeric inputs within the same public task families; this is not cross-domain transfer.',
    'metric':'Formula presence plus independently recalculated numeric correctness; source cell preservation reported separately.',
},indent=2))
