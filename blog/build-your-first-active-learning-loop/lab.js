(() => {
  'use strict';
  const M=window.ProjectModel, data=window.TICKETS, $=id=>document.getElementById(id);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let runs, phase, guide=false;
  const names={entropy:'Uncertainty sampling',random:'Random sampling'};
  const fmt=x=>(x*100).toFixed(1)+'%';
  function reset() {
    runs=['entropy','random'].map(s=>new M.Run(data,s,Number($('run-seed').value)));
    phase=0;render();
  }
  function bars(p) {
    return p.map((v,i)=>`<div class="prob-row"><span>${M.classes[i]}</span><span class="prob-track"><i style="width:${v*100}%"></i></span><b>${fmt(v)}</b></div>`).join('');
  }
  function render() {
    const first=runs[0],closed=first.closed, complete=first.round===6;
    $('round-stat').textContent=`${first.round} / 6`;
    $('labels-stat').textContent=first.labeled.length;
    $('pool-stat').textContent=first.pool.length;
    $('phase-stat').textContent=closed?'Finished':['Ready to select','Batch selected','Labels revealed'][phase];
    $('loop-next').textContent=['1. Select the next batches','2. Reveal their labels','3. Retrain and evaluate'][phase];
    $('loop-next').disabled=closed||complete;
    $('finish-run').disabled=closed||phase!==0;
    $('finish-run').textContent=complete?'Finish and open the test report':'Stop here and open the test report';
    $('run-status').textContent=closed?'Both models are frozen. The final test report is open. Reset starts a new teaching run.':complete?'Six acquisition rounds are complete. Finish to evaluate the frozen models on the test set.':[
      `Round ${first.round}: compare validation evidence, then choose the next batch.`,
      'The models have chosen three tickets each. Their labels have not been used. Inspect the choices before revealing them.',
      'The oracle has supplied the reference labels. The model and validation curve have not changed yet. Retrain to use the new evidence.'
    ][phase];
    if(first.round>0&&phase===0&&!closed&&!complete) $('guide-text').textContent=`Round ${first.round} is complete. Compare the validation scores, then select another batch or finish the run. The last batch remains visible so you can inspect what changed.`;
    $('guide-panel').hidden=!guide;
    $('guide-text').textContent=closed?'You have completed the walkthrough. Compare the class counts below, then run the Python project.':[
      'Step 1: select a batch. Both strategies begin with the same six labels. Notice that their validation scores are identical at round zero.',
      'Step 2: read one ticket from each batch. Look at the uncertainty probabilities. Can you explain the selected ticket without seeing its label?',
      'Step 3: labels are now visible. Retrain, then compare the new validation scores. A purchased label does not improve a model until the update uses it.'
    ][phase];
    if(complete&&!closed) $('guide-text').textContent='The label budget is spent. Finish the run to open the test report. A budget limit does not establish deployment readiness.';
    $('strategy-panels').innerHTML=runs.map(r=>`<section class="strategy ${r.strategy}"><h4>${names[r.strategy]}</h4><p class="score">${fmt(r.metrics.macro_f1)} <span>validation macro F1</span></p><p class="small">${r.metrics.per_class.map(x=>`${x.label}: ${x.correct}/${x.total} correct`).join(' · ')}</p><div class="batch-cards">${r.selected.length?r.selected.map(x=>`<article class="ticket"><div class="ticket-top"><span>${x.id}</span><span>${r.strategy==='entropy'?x.entropy.toFixed(3)+' bits':'uniform random choice'}</span></div><p>${escape(x.text)}</p>${x.probabilities?bars(x.probabilities):''}<p class="label-reveal">${x.label?'Reference label: <strong>'+x.label+'</strong>':'Reference label hidden'}</p></article>`).join(''):'<p class="empty-state">No batch selected yet. The six seed labels have already trained this model.</p>'}</div><p class="small">${r.selected.length&&phase===0?'Showing the last acquired batch. Probabilities were recorded before its labels were revealed.':''}</p></section>`).join('');
    $('curve-table').innerHTML=first.history.map((r,i)=>`<tr><td>${r.round}</td><td>${r.labels}</td><td>${fmt(r.macro_f1)}</td><td>${fmt(runs[1].history[i].macro_f1)}</td></tr>`).join('');
    drawChart(); renderCosts(); renderPrediction();
    $('test-report').hidden=!closed;
    if(closed) $('test-results').innerHTML=runs.map(r=>`<div><h4>${names[r.strategy]}</h4><p><strong>${fmt(r.test.macro_f1)}</strong> macro F1 on ${r.test.n} test tickets</p><ul>${r.test.per_class.map(c=>`<li>${c.label}: ${c.correct} / ${c.total} correct; F1 ${c.f1.toFixed(3)}</li>`).join('')}</ul></div>`).join('');
  }
  function drawChart() {
    const parts=['<title>Validation macro F1 after each completed round</title>'];
    for(const v of [0,.25,.5,.75,1]) {
      const y=250-200*v;parts.push(`<path d="M52 ${y}H680" stroke="#dce5de"/><text x="7" y="${y+4}">${v.toFixed(2)}</text>`);
    }
    for(let i=0;i<=6;i++)parts.push(`<text x="${52+i*104-5}" y="275">${6+i*3}</text>`);
    for(const r of runs) {
      const pts=r.history.map(p=>`${52+p.round*104},${250-p.macro_f1*200}`).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${r.strategy==='entropy'?'#117c72':'#a85139'}" stroke-width="3" ${r.strategy==='random'?'stroke-dasharray="7 5"':''}/>`);
      for(const p of r.history)parts.push(`<circle cx="${52+p.round*104}" cy="${250-p.macro_f1*200}" r="${r.strategy==='entropy'?5:3}" fill="${r.strategy==='entropy'?'#117c72':'#a85139'}"/>`);
    }
    parts.push('<text x="52" y="23">Validation macro F1 ↑</text><text x="445" y="305">Training labels →</text>');
    $('project-chart').innerHTML=parts.join('');
  }
  function renderCosts() {
    const minutes=Number($('annotation-minutes').value),r=runs[0], purchased=r.labeled.length+(phase===2?r.selected.length:0);
    $('minutes-value').textContent=minutes+' min / label';
    $('cost-results').innerHTML=`<p><strong>${purchased*minutes} human minutes</strong> for the ${purchased} training labels obtained by each strategy so far${phase===2?' (three are waiting for the update)':''}. The fixed 18 validation/test labels add ${18*minutes} minutes to a single-strategy project.</p><table><thead><tr><th>Work so far</th><th>Uncertainty</th><th>Random</th></tr></thead><tbody><tr><td>Pool documents scored for acquisition</td><td>${runs[0].scoreWork}</td><td>${runs[1].scoreWork}</td></tr><tr><td>Documents processed across full refits</td><td>${runs[0].fitWork}</td><td>${runs[1].fitWork}</td></tr><tr><td>Validation predictions</td><td>${(r.round+1)*9}</td><td>${(r.round+1)*9}</td></tr><tr><td>Final test predictions</td><td>${r.closed?9:0}</td><td>${r.closed?9:0}</td></tr></tbody></table>`;
  }
  function renderPrediction() {
    const model=runs[0].model,text=$('ticket-input').value,p=model.probabilities(text),words=M.tokens(text),known=words.filter(w=>model.vocab.has(w));
    $('prediction-bars').innerHTML=bars(p);
    $('prediction-reading').textContent=`${known.length} of ${words.length} word occurrences are in the current vocabulary. Entropy: ${M.entropy(p).toFixed(3)} bits. ${known.length?'The largest score suggests '+M.classes[p.indexOf(Math.max(...p))]+'.':'No known words: the uniform prior gives a three-way tie. This is missing vocabulary, not an understanding of the request.'}`;
  }
  function next() { if(runs[0].closed||runs[0].round===6)return;for(const r of runs)r[['select','reveal','update'][phase]]();phase=(phase+1)%3;render(); }
  $('loop-next').addEventListener('click',next);
  $('finish-run').addEventListener('click',()=>{runs.forEach(r=>r.finish());render();$('test-report').scrollIntoView({block:'center'});$('test-heading').focus({preventScroll:true});});
  $('reset-run').addEventListener('click',reset);
  $('run-seed').addEventListener('change',reset);
  $('start-guide').addEventListener('click',()=>{guide=true;reset();$('project-lab').scrollIntoView({block:'start'});$('guide-heading').focus({preventScroll:true});});
  $('exit-guide').addEventListener('click',()=>{guide=false;render();});
  $('annotation-minutes').addEventListener('input',renderCosts);
  $('ticket-input').addEventListener('input',renderPrediction);
  document.querySelectorAll('[data-ticket]').forEach(b=>b.addEventListener('click',()=>{$('ticket-input').value=b.dataset.ticket;renderPrediction();}));
  function uncertainty() {
    const weights=[0,1,2].map(i=>Number($('weight-'+i).value)),sum=weights.reduce((a,b)=>a+b,0),p=weights.map(x=>x/sum);
    weights.forEach((x,i)=>$('weight-value-'+i).textContent=x);
    $('entropy-bars').innerHTML=bars(p);
    $('entropy-value').textContent=M.entropy(p).toFixed(3)+' bits';
    $('entropy-equation').innerHTML=p.map((x,i)=>{
      const value=(-x*Math.log2(x)).toFixed(3), probability=x.toFixed(3);
      return `<div class="entropy-term"><span>${M.classes[i]}</span><div class="math-scroll"><math xmlns="http://www.w3.org/1998/Math/MathML" aria-label="${M.classes[i]} contributes approximately ${value} bits"><mrow><mo>−</mo><mn>${probability}</mn><mspace width="0.16em"/><msub><mi mathvariant="normal">log</mi><mn>2</mn></msub><mo>(</mo><mn>${probability}</mn><mo>)</mo><mo>≈</mo><mn>${value}</mn></mrow></math></div></div>`;
    }).join('')+`<div class="entropy-total"><math xmlns="http://www.w3.org/1998/Math/MathML" aria-label="Total entropy approximately ${M.entropy(p).toFixed(3)} bits"><mi>H</mi><mo>≈</mo><mn>${M.entropy(p).toFixed(3)}</mn><mspace width="0.3em"/><mtext>bits</mtext></math></div><p class="small">Displayed probabilities and contributions are rounded. The total uses the full-precision values.</p>`;
  }
  [0,1,2].forEach(i=>$('weight-'+i).addEventListener('input',uncertainty));
  document.querySelectorAll('[data-weights]').forEach(b=>b.addEventListener('click',()=>{b.dataset.weights.split(',').forEach((w,i)=>$('weight-'+i).value=w);uncertainty();}));
  document.querySelectorAll('[data-interactive]').forEach(el=>el.disabled=false);
  const motion=matchMedia('(prefers-reduced-motion: reduce)'),hero=$('loop-hero');let playing=!motion.matches;
  function motionState(){hero.classList.toggle('playing',playing);$('motion-toggle').textContent=playing?'Pause animation':'Play animation';}
  $('motion-toggle').hidden=false;$('motion-toggle').addEventListener('click',()=>{playing=!playing;motionState();});
  motion.addEventListener('change',()=>{playing=!motion.matches;motionState();});motionState();
  reset();uncertainty();
})();
