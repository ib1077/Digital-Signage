"use strict";
window.FareView = {
  render(container, data) {
    const byPair = new Map(data.fares.map(f => [[f.from, f.to].sort().join('/'), f.amount]));
    const money = value => value.toLocaleString('ja-JP') + '円';
    let origin = '', destination = '';
    container.innerHTML = `<div class="fare-view">
      <div class="fare-controls"><label for="fareOrigin">どこから乗りますか？</label><select id="fareOrigin"><option value="">出発駅を選んでください</option></select></div>
      <div class="fare-layout"><section class="fare-destinations"><h3>どこまで行きますか？</h3><div class="station-buttons"></div></section>
      <section class="fare-result" aria-live="polite"><p class="fare-route"></p><div class="fare-amount"></div><p class="fare-category">資料記載の運賃</p></section></div>
      <p class="fare-note"></p><p class="fare-station-note"></p>
      <details class="fare-table-details"><summary>運賃表を表示</summary><div class="fare-table-scroll"></div></details>
    </div>`;
    const select = container.querySelector('#fareOrigin');
    const buttons = container.querySelector('.station-buttons');
    const route = container.querySelector('.fare-route');
    const amount = container.querySelector('.fare-amount');
    function renderResult() {
      for (const button of buttons.children) {
        button.disabled = !origin || button.dataset.station === origin;
        button.setAttribute('aria-pressed', String(button.dataset.station === destination));
      }
      if (!origin) { route.textContent = 'まず出発駅を選んでください'; amount.textContent = '—'; return; }
      if (!destination) { route.textContent = `${data.stations.find(s=>s.id===origin).name}から`; amount.textContent = '到着駅を選択'; return; }
      route.textContent = `${data.stations.find(s=>s.id===origin).name} → ${data.stations.find(s=>s.id===destination).name}`;
      const value = byPair.get([origin,destination].sort().join('/'));
      amount.textContent = value === undefined ? '記載なし' : money(value);
    }
    for (const station of data.stations) {
      const option = document.createElement('option');option.value=station.id;option.textContent=station.name;select.append(option);
      const button=document.createElement('button');button.type='button';button.dataset.station=station.id;button.textContent=station.name;
      button.addEventListener('click',()=>{destination=station.id;renderResult();});buttons.append(button);
    }
    select.addEventListener('change',()=>{origin=select.value;destination='';renderResult();});
    container.querySelector('.fare-note').textContent=data.displayNote;
    container.querySelector('.fare-station-note').textContent=data.stationNote;
    const table=document.createElement('table');const caption=document.createElement('caption');caption.textContent='運賃表（円）';table.append(caption);
    const head=document.createElement('thead');const headRow=document.createElement('tr');
    const corner=document.createElement('th');corner.textContent='発 ／ 着';headRow.append(corner);
    for(const station of data.stations){const th=document.createElement('th');th.scope='col';th.textContent=station.name;headRow.append(th);}
    head.append(headRow);table.append(head);const tbody=document.createElement('tbody');
    for(const from of data.stations){const tr=document.createElement('tr');const th=document.createElement('th');th.scope='row';th.textContent=from.name;tr.append(th);
      for(const to of data.stations){const td=document.createElement('td');const value=byPair.get([from.id,to.id].sort().join('/'));td.textContent=from.id===to.id?'—':value?.toLocaleString('ja-JP')??'記載なし';tr.append(td);}tbody.append(tr);}
    table.append(tbody);container.querySelector('.fare-table-scroll').append(table);renderResult();
  }
};
