(function(root){
  'use strict';
  const POLICY='You may cancel at any time: cancellation stops the next renewal, and access continues to the end of the paid period. A normal refund requires a request within 14 calendar days of the initial purchase AND no export use. Renewals are not refundable. A confirmed duplicate charge is refundable regardless of age or export use. Ask for missing facts. Never claim to have processed an action; tell eligible customers to contact support with charge details.';
  const cases=[
    {id:'P1',topic:'Initial purchase',question:'I bought my first plan 8 days ago and have not exported anything. Can I get a refund?',draft:'You may qualify, but I am not sure whether the limit is 7 or 14 days.',answer:'Yes. Your initial purchase is within 14 days and you have made no exports, so you are eligible. Contact support with the charge details to request the refund.',traces:[[.46,.43,.08,.03],[.55,.35,.07,.03],[.61,.29,.06,.04]],reason:'This answer shows how the time limit and export condition apply together.'},
    {id:'P2',topic:'Export restriction',question:'My initial purchase was 6 days ago, but I used an export. Am I eligible?',draft:'Because your purchase was recent, you may still be eligible for a refund.',answer:'No. A normal refund requires both a request within 14 days and no export use. Since you used an export, the normal refund rule does not apply.',traces:[[.40,.38,.12,.10],[.48,.30,.12,.10],[.56,.26,.10,.08]],reason:'This is a tempting shortcut: using the purchase date while ignoring the second condition.'},
    {id:'P3',topic:'Missing facts',question:'I bought the plan recently. Can I have my money back?',draft:'Yes, you should be able to get your money back.',answer:'Was this your initial purchase or a renewal, on what date was the charge, and have you used any exports? Those details are needed to apply the refund policy.',traces:[[.34,.31,.21,.14],[.42,.28,.18,.12],[.46,.29,.15,.10]],reason:'The answer needs to ask for the missing details before deciding eligibility.'},
    {id:'P4',topic:'Duplicate charge',question:'Support confirmed two charges for one purchase. I have already used exports. Can the duplicate be refunded?',draft:'Export use normally prevents refunds, although duplicate payments may be different.',answer:'Yes. A confirmed duplicate charge is refundable regardless of export use or age. Contact support with the duplicate charge details to request the refund.',traces:[[.37,.34,.17,.12],[.43,.32,.15,.10],[.49,.29,.14,.08]],reason:'This answer explains the duplicate-charge exception.'},
    {id:'P5',topic:'Outside the window',question:'My initial purchase was 19 days ago and I have not used an export. Can I get a refund?',draft:'Yes. If you have not exported anything, you can receive a refund.',answer:'No. The normal refund rule requires a request within 14 calendar days of the initial purchase as well as no export use. Nineteen days is outside that window.',traces:[[.95,.03,.01,.01],[.92,.04,.02,.02],[.94,.03,.02,.01]],reason:'This constructed draft is confidently wrong. Entropy alone can miss it; audits and coverage checks still matter.'},
    {id:'P6',topic:'Cancellation',question:'I cancelled today. Can I still use my account this week?',draft:'Access continues until the end of your paid period; cancellation stops the next renewal.',answer:'You retain access until the end of your paid period. Whether that covers the whole week depends on when your paid period ends. Cancellation stops the next renewal.',traces:[[.87,.07,.04,.02],[.90,.06,.03,.01],[.91,.04,.03,.02]],reason:'The seed already covers the main cancellation rule. Another similar answer may add less useful information.'},
    {id:'P7',topic:'Renewal',question:'I was charged for a normal renewal yesterday. Can I reverse it?',draft:'Normal renewals are not refundable. You can cancel to stop the next renewal.',answer:'Normal renewals are not refundable under this policy. You can cancel to stop the next renewal, and access continues for the paid period.',traces:[[.94,.03,.02,.01],[.91,.05,.03,.01],[.93,.04,.02,.01]],reason:'This repeats a rule covered by the seed. It can still be useful if real evaluation reveals a gap.'},
    {id:'P8',topic:'Initial purchase',question:'I bought my first subscription 12 days ago and made no exports. How do I request a refund?',draft:'You might qualify under the initial-purchase rule. Contact support to check.',answer:'You are eligible because the initial purchase was within 14 calendar days and you have made no exports. Contact support with the charge details to request the refund.',traces:[[.50,.37,.08,.05],[.61,.27,.08,.04],[.66,.23,.07,.04]],reason:'This overlaps with P1. Selecting both would use two annotations on similar questions.'}
  ];
  const entropy=p=>Math.max(0,-p.reduce((s,x)=>s+(x>0?x*Math.log2(x):0),0));
  const score=r=>r.traces.reduce((s,p)=>s+entropy(p),0)/r.traces.length;
  function randomBatch(seed,n){let state=seed>>>0;const shuffled=[...cases];for(let i=shuffled.length-1;i>0;i--){let t=state=(state+0x6D2B79F5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);const j=Math.floor(((t^(t>>>14))>>>0)/4294967296*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}return shuffled.slice(0,n);}
  const rank=()=>[...cases].sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  const api={POLICY,cases,entropy,score,randomBatch,rank};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}
  root.LLMTeaching=api;
  const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let stage=0,selected=[],answers={},approved=false;
  function reset(){stage=0;selected=[];answers={};approved=false;$('training-records').hidden=true;$('approval-status').textContent='';$('record-code').textContent='';$('reviewer-cards').innerHTML='';render();}
  function render(){
    const n=Number($('annotation-budget').value),strategy=$('acquisition-rule').value;
    $('al-stage').textContent=['Pool ready','Scores available','Batch selected','Reviewer answers'][stage];
    $('al-used').textContent=approved?n:0;
    $('al-total').textContent=4+(approved?n:0);
    $('al-remaining').textContent=8-(approved?n:0);
    $('al-next').disabled=stage===3;
    $('al-next').textContent=['1. Inspect the pool scores','2. Choose questions to annotate','3. Open the reviewer workspace'][stage]||'Review the selected answers below';
    $('acquisition-rule').disabled=stage>0;$('annotation-budget').disabled=stage>0;
    $('al-status').textContent=approved?`${n} answers approved. The training set now contains ${4+n} demonstrations. The next step is to train the adapter, then rescore the remaining ${8-n} questions.`:[
      'Start with four approved answers and eight questions awaiting annotation. Choose how many questions to select, then view their scores.',
      'These example scores illustrate how uncertainty sampling works. They are not Qwen outputs. Review the questions, then select a batch.',
      `The ${strategy==='entropy'?'uncertainty':'random'} rule selected ${selected.map(r=>r.id).join(', ')}. The reviewer has not supplied answers yet.`,
      'Read the policy and revise each answer. Approved responses become targets for supervised fine-tuning; the model drafts are not targets.'
    ][stage];
    $('pool-cards').innerHTML=(stage?rank():cases).map(r=>`<article class="pool-card ${selected.some(s=>s.id===r.id)?'is-selected':''}"><div class="ticket-top"><strong>${r.id} / ${esc(r.topic)}</strong><span>${stage?score(r).toFixed(3)+' illustrative bits':'Not scored'}</span></div><p>${esc(r.question)}</p>${stage?`<details><summary>Inspect the draft and score trace</summary><p><strong>Illustrative draft:</strong> ${esc(r.draft)}</p><p class="small">Three illustrative positions, each with a four-token teaching distribution:</p><ol>${r.traces.map(p=>`<li><code>[${p.join(', ')}]</code> → ${entropy(p).toFixed(3)} bits</li>`).join('')}</ol><p class="small">Mean = ${score(r).toFixed(3)} bits. These distributions simplify the arithmetic; they are not actual tokenization or logits of the displayed draft.</p></details>`:''}</article>`).join('');
    $('comparison-note').hidden=stage<2;
    if(stage>=2){const active=rank().slice(0,n),random=randomBatch(7,n);$('comparison-note').innerHTML=`<strong>Same budget, different questions.</strong><p>Uncertainty chooses ${active.map(r=>r.id+' ('+r.topic+')').join(', ')}. Uniform random sampling with seed 7 chooses ${random.map(r=>r.id+' ('+r.topic+')').join(', ')}.</p><p class="small">This compares acquisition choices, not trained-model quality. Only a held-out evaluation after actual updates can establish which batch helped more.</p>`;}
    $('reviewer-panel').hidden=stage<3;
    if(stage===3&&!approved){$('reviewer-cards').innerHTML=selected.map(r=>`<article class="reviewer-card"><h4>${r.id}: ${esc(r.question)}</h4><p class="small">${esc(r.reason)}</p><label for="answer-${r.id}">Your approved answer</label><textarea id="answer-${r.id}" data-answer="${r.id}" rows="4" placeholder="Write an answer grounded in the policy.">${esc(answers[r.id]||'')}</textarea><button class="secondary" type="button" data-suggest="${r.id}">Load an example reviewer answer</button></article>`).join('');}
    $('approve-answers').disabled=approved;$('reviewer-cards').querySelectorAll('textarea,button').forEach(el=>el.disabled=approved);
  }
  $('al-next').addEventListener('click',()=>{if(stage>=3)return;stage++;if(stage===2)selected=$('acquisition-rule').value==='entropy'?rank().slice(0,Number($('annotation-budget').value)):randomBatch(7,Number($('annotation-budget').value));render();if(stage===3){$('reviewer-panel').scrollIntoView({block:'start'});$('reviewer-heading').focus({preventScroll:true});}});
  $('reset-acquisition').addEventListener('click',reset);
  $('start-acquisition').addEventListener('click',()=>{reset();$('acquisition-lab').scrollIntoView({block:'start'});$('acquisition-heading').focus({preventScroll:true});});
  $('reviewer-cards').addEventListener('input',e=>{if(e.target.dataset.answer)answers[e.target.dataset.answer]=e.target.value;});
  $('reviewer-cards').addEventListener('click',e=>{const id=e.target.dataset.suggest;if(!id)return;const r=cases.find(r=>r.id===id);answers[id]=r.answer;$('answer-'+id).value=r.answer;});
  $('approve-answers').addEventListener('click',()=>{
    if(selected.some(r=>!(answers[r.id]||'').trim())){$('approval-status').textContent='Write or load an answer for every selected question before approving the batch.';return;}
    approved=true;
    const records=selected.map(r=>({id:r.id,policy:POLICY,question:r.question,answer:answers[r.id].trim()}));
    $('record-code').innerHTML=records.map(r=>`<div><span>${esc(r.id)} / Reviewed training example</span><p><strong>Question:</strong> ${esc(r.question)}</p><p><strong>Approved answer:</strong> ${esc(r.answer)}</p></div>`).join('');$('training-records').hidden=false;
    $('approval-status').textContent='The approved responses are now supervised targets. Prompt tokens are masked from the loss; response tokens, including the end-of-turn token, are trained.';
    $('mask-preview').innerHTML=`<div class="masked"><span>Input context / loss masked</span><p>System instruction + supplied policy + ${esc(selected[0].question)}</p></div><div class="supervised"><span>Response target / loss computed</span><p>${esc(answers[selected[0].id])}</p></div>`;
    render();$('training-records').scrollIntoView({block:'start'});
  });
  // One next-token distribution, independent of acquisition state.
  const tokenOptions=['eligible','ineligible','unsure','sorry'];
  function tokenRender(){
    const weights=[0,1,2,3].map(i=>Number($('logit-'+i).value)),max=Math.max(...weights),exps=weights.map(w=>Math.exp(w-max)),total=exps.reduce((a,b)=>a+b,0),p=exps.map(x=>x/total);
    weights.forEach((v,i)=>$('logit-value-'+i).textContent=v.toFixed(1));
    $('token-bars').innerHTML=p.map((v,i)=>`<div class="prob-row"><span>${tokenOptions[i]}</span><span class="prob-track"><i style="width:${100*v}%"></i></span><b>${(100*v).toFixed(1)}%</b></div>`).join('');
    $('token-entropy').textContent=entropy(p).toFixed(3)+' bits';$('greedy-token').textContent=tokenOptions[p.indexOf(Math.max(...p))];
    $('token-reading').textContent='Greedy decoding chooses the highest-probability token. Entropy describes how spread out the probabilities are. A low value does not mean the answer follows the policy.';
  }
  for(let i=0;i<4;i++)$('logit-'+i).addEventListener('input',tokenRender);
  document.querySelectorAll('[data-logits]').forEach(b=>b.addEventListener('click',()=>{b.dataset.logits.split(',').forEach((v,i)=>$('logit-'+i).value=v);tokenRender();}));
  $('check-review').addEventListener('click',()=>{const choice=document.querySelector('input[name="review-choice"]:checked');$('review-result').textContent=!choice?'Choose a response to review.':choice.value==='B'?'Correct. B applies both eligibility conditions, gives the right next step, and does not claim an action was taken. That is what this held-out task measures.':choice.value==='A'?'A wrongly claims the refund has already been processed. A fluent answer can still fail the action and grounding checks.':'C invents a seven-day limit. It fails the policy-correctness check even though it sounds confident.';});
  function budget(){const pool=Number($('cost-pool').value),batch=Number($('cost-batch').value),minutes=Number($('cost-minutes').value),tokens=Number($('cost-tokens').value);$('budget-result').textContent=`${batch} approved answers × ${minutes} minutes ≈ ${batch*minutes} minutes of annotation for this batch. Scoring ${pool} prompts with up to ${tokens} generated tokens per prompt requires at most ${(pool*tokens).toLocaleString()} decode steps, plus prompt prefills. Random selection needs no uncertainty-scoring generation. Training and evaluation are additional costs.`;}
  ['cost-pool','cost-batch','cost-minutes','cost-tokens'].forEach(id=>$(id).addEventListener('input',budget));
  document.querySelectorAll('[data-llm]').forEach(el=>el.disabled=false);
  const hero=$('loop-hero'),motion=matchMedia('(prefers-reduced-motion: reduce)');let playing=!motion.matches;
  function setMotion(){hero.classList.toggle('playing',playing);$('motion-toggle').textContent=playing?'Pause animation':'Play animation';}
  $('motion-toggle').hidden=false;$('motion-toggle').addEventListener('click',()=>{playing=!playing;setMotion();});motion.addEventListener('change',()=>{playing=!motion.matches;setMotion();});
  setMotion();reset();tokenRender();budget();
})(typeof globalThis!=='undefined'?globalThis:this);
