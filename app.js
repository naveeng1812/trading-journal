
// ==================== SUPABASE CONFIG ====================
// Supabase configured with project credentials
const SUPABASE_URL = 'https://qxraupcxgiagrerpofda.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cmF1cGN4Z2lhZ3JlcnBvZmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMzkyODAsImV4cCI6MjEwNDYxNTI4MH0.gmXMJKt7q2YKZnKm1Jx3bgK-yS-GaBe3EAw-T-r-xtA';
let supabaseClient = null;
let currentUser = null;
let isSignUp = false;

function initSupabase(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.length < 10){
    // Supabase not configured yet — run in demo mode (no auth)
    console.warn('Supabase not configured. Running in demo mode. Set SUPABASE_URL and SUPABASE_ANON_KEY to enable auth.');
    return false;
  }
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  } catch(e) {
    console.error('Supabase init failed:', e);
    return false;
  }
}

// ==================== AUTH ====================
function toggleAuthMode(){
  isSignUp = !isSignUp;
  document.getElementById('authTitle').textContent = isSignUp ? 'Create Account' : 'Welcome Back';
  document.getElementById('authSubtitle').textContent = isSignUp ? 'Start tracking your trades today' : 'Sign in to access your trading journal';
  document.getElementById('authBtn').textContent = isSignUp ? 'Sign Up' : 'Sign In';
  document.getElementById('authToggleText').textContent = isSignUp ? 'Already have an account? ' : "Don't have an account? ";
  document.getElementById('authToggleLink').textContent = isSignUp ? 'Sign in' : 'Sign up';
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg){
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

async function handleAuth(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const btn = document.getElementById('authBtn');
  
  if(!email || !password){ showAuthError('Please enter email and password'); return; }
  if(password.length < 6){ showAuthError('Password must be at least 6 characters'); return; }
  
  btn.disabled = true;
  btn.textContent = isSignUp ? 'Creating account...' : 'Signing in...';
  document.getElementById('authError').classList.remove('show');
  
  try {
    if(isSignUp){
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if(error) throw error;
      if(data.user && !data.session){
        // Email confirmation required
        showAuthError('Account created! Check your email to confirm, then sign in.');
        isSignUp = false;
        toggleAuthMode();
        btn.disabled = false;
        btn.textContent = 'Sign In';
        return;
      }
      currentUser = data.user;
      toast('Account created! Welcome to TradingFXJournal.com', 'success');
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if(error) throw error;
      currentUser = data.user;
      toast('Welcome back!', 'success');
    }
    showApp();
  } catch(e) {
    let msg = e.message || 'Something went wrong';
    if(msg.includes('Invalid login')) msg = 'Wrong email or password';
    if(msg.includes('Email not confirmed')) msg = 'Please confirm your email first (check your inbox)';
    showAuthError(msg);
  }
  btn.disabled = false;
  btn.textContent = isSignUp ? 'Sign Up' : 'Sign In';
}

async function handleGoogleSignIn(){
  const btn = document.querySelector('.google-btn');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  document.getElementById('authError').classList.remove('show');
  try {
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://naveeng1812.github.io/trading-journal/index-app.html' }
    });
    if(error) throw error;
    // Supabase will redirect to Google, then back here.
    // The onAuthStateChange listener in init will handle the rest.
  } catch(e) {
    let msg = e.message || 'Google sign-in failed';
    showAuthError(msg);
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

async function handleLogout(){
  if(supabaseClient){
    await supabaseClient.auth.signOut();
  }
  currentUser = null;
  state.trades = [];
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  toast('Logged out', 'info');
}

// ==================== CLOUD SYNC (SUPABASE) ====================
var __lastPullAt=0;
async function syncPull(){
  if(!supabaseClient||!currentUser)return;
  const now=Date.now();if(now-__lastPullAt<4000)return;__lastPullAt=now;
  try{
    const {data,error}=await supabaseClient.from('trades').select('*').order('date',{ascending:false});
    if(error)throw error;
    if(Array.isArray(data)){
      state.trades=data.map(t=>({id:t.id,symbol:t.symbol,side:t.side,setup:t.setup||'',entry:t.entry,exit:t.exit_price,qty:t.qty,pnl:t.pnl,r:t.r||0,date:t.date,notes:t.notes||''}));
    }
    const res=await supabaseClient.from('user_settings').select('settings').eq('user_id',currentUser.id);
    if(!res.error&&res.data&&res.data.length&&res.data[0].settings){
      state.settings={...state.settings,...res.data[0].settings};
      if(typeof loadSettingsForm==='function')loadSettingsForm();
    }
    saveState();
    if(typeof refreshCurrentView==='function')refreshCurrentView();
    if(state.trades.length)toast('Trades synced from cloud','success');
  }catch(e){
    console.warn('Cloud sync failed:',e.message||e);
    toast('Cloud sync failed — check your connection','error');
  }
}
async function syncPushTrade(t){
  if(!supabaseClient||!currentUser||!t)return;
  try{
    const {error}=await supabaseClient.from('trades').upsert({
      id:t.id,user_id:currentUser.id,symbol:t.symbol,side:t.side,setup:t.setup||'',
      entry:t.entry,exit_price:t.exit,qty:t.qty,pnl:t.pnl,r:t.r||0,date:t.date,notes:t.notes||''
    });
    if(error)throw error;
  }catch(e){
    console.warn('Cloud push failed:',e.message||e);
    toast('Saved on this device — cloud save failed','error');
  }
}
async function syncDeleteTrade(id){
  if(!supabaseClient||!currentUser)return;
  try{
    const {error}=await supabaseClient.from('trades').delete().eq('id',id);
    if(error)throw error;
  }catch(e){
    console.warn('Cloud delete failed:',e.message||e);
  }
}
async function syncPushSettings(){
  if(!supabaseClient||!currentUser)return;
  try{
    const {error}=await supabaseClient.from('user_settings').upsert({user_id:currentUser.id,settings:state.settings});
    if(error)throw error;
  }catch(e){
    console.warn('Settings sync failed:',e.message||e);
  }
}

function showApp(){
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('mainApp').style.display = 'grid';
  // Update user info in sidebar
  if(currentUser && currentUser.email){
    const initials = currentUser.email.substring(0, 2).toUpperCase();
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userName').textContent = currentUser.email.split('@')[0];
  }
  // Load user-specific data and render
  loadState();
  if(!state.trades.length && !currentUser){ seedData(); }
  loadSettingsForm();
  renderDashboard();
  if(currentUser){ syncPull(); }
}

function getStorageKey(){
  // Each user gets their own localStorage key
  if(currentUser && currentUser.id){
    return 'tradezella_state_' + currentUser.id;
  }
  return 'tradezella_state';
}

// ==================== STATE ====================
let state = { trades: [], settings: { accountName:'Funded Account', startBalance:50000, currency:'USD ($)', maxDailyLoss:1000, maxDailyTrades:20, riskPerTrade:2 }, calMonth: new Date().getMonth(), calYear: new Date().getFullYear(), sortKey:'date', sortDir:'desc', filters:{search:'',side:'',setup:'',symbol:''} };
let charts = {};
const SYMBOL_COLORS = {'EURUSD':'#10b981','GBPUSD':'#f59e0b','USDJPY':'#06b6d4','XAUUSD':'#fbbf24','US30':'#22d3ee','SPX500':'#34d399','NAS100':'#f87171','AAPL':'#a78bfa','TSLA':'#ef4444','BTCUSD':'#3b82f6','ETHUSD':'#06b6d4','USDCAD':'#a78bfa','AUDUSD':'#34d399','WTI':'#60a5fa'};
function getColor(symbol){return SYMBOL_COLORS[symbol] || '#7a8599';}
function fmt(n){return Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtPnl(n){const sign=n>0?'+':'−';return sign+'$'+fmt(n);}
function fmtDate(d){const dt=new Date(d);return dt.toLocaleDateString('en-US',{month:'short',day:'numeric'});}

// ==================== STORAGE ====================
function saveState(){try{localStorage.setItem(getStorageKey(),JSON.stringify(state));}catch(e){console.warn('Storage error:',e);}}
function loadState(){try{const s=localStorage.getItem(getStorageKey());if(s){const parsed=JSON.parse(s);if(parsed.trades&&parsed.settings){state={...state,...parsed};return true;}}}catch(e){}return false;}

// ==================== SEED DATA ====================
function seedData(){
  const setups=['Breakout','Pullback','Reversal','Breakdown','Trend Following','Scalp','Swing'];
  const symbols=['EURUSD','GBPUSD','USDJPY','XAUUSD','US30','SPX500','NAS100','AAPL','TSLA','BTCUSD'];
  const trades=[];let id=1;
  function getEntry(sym){
    if(sym==='EURUSD'||sym==='GBPUSD')return 0.8+Math.random()*0.8;
    if(sym==='USDJPY')return 140+Math.random()*20;
    if(sym==='XAUUSD')return 1800+Math.random()*800;
    if(sym==='US30')return 32000+Math.random()*8000;
    if(sym==='SPX500')return 4500+Math.random()*1000;
    if(sym==='NAS100')return 15000+Math.random()*5000;
    if(sym==='AAPL')return 150+Math.random()*100;
    if(sym==='TSLA')return 150+Math.random()*150;
    if(sym==='BTCUSD')return 40000+Math.random()*60000;
    if(sym==='ETHUSD')return 2000+Math.random()*3000;
    return 100+Math.random()*1000;
  }
  function getQty(sym){
    if(sym==='EURUSD'||sym==='GBPUSD'||sym==='USDJPY')return Math.round((0.1+Math.random()*1.9)*10)/10;
    if(sym==='XAUUSD')return Math.round((0.1+Math.random()*1.9)*10)/10;
    if(sym==='US30'||sym==='SPX500'||sym==='NAS100')return Math.ceil(Math.random()*10);
    if(sym==='AAPL'||sym==='TSLA')return Math.ceil(Math.random()*90)+10;
    if(sym==='BTCUSD'||sym==='ETHUSD')return Math.round((0.1+Math.random()*1.9)*10)/10;
    return Math.ceil(Math.random()*100)+5;
  }
  for(let i=0;i<40;i++){
    const daysAgo=Math.floor(Math.random()*30);
    const d=new Date();d.setDate(d.getDate()-daysAgo);
    const symbol=symbols[Math.floor(Math.random()*symbols.length)];
    const side=Math.random()>0.4?'Long':'Short';
    const setup=setups[Math.floor(Math.random()*setups.length)];
    const entry=getEntry(symbol);
    const win=Math.random()>0.36;
    const movePct=(Math.random()*0.02+0.001)*(win?1:-1)*(side==='Long'?1:-1);
    const exit=entry*(1+movePct);
    const qty=getQty(symbol);
    const pnl=(exit-entry)*qty*(side==='Long'?1:-1);
    const risk=Math.abs(entry*qty*0.005);
    const r=pnl/risk;
    trades.push({id:id++,symbol,side,setup,entry:Math.round(entry*100)/100,exit:Math.round(exit*100)/100,qty,pnl:Math.round(pnl*100)/100,r:Math.round(r*100)/100,date:d.toISOString().split('T')[0],notes:''});
  }
  trades.sort((a,b)=>new Date(b.date)-new Date(a.date));
  state.trades=trades;saveState();
}

// ==================== ROUTER ====================
function switchView(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('view--active'));
  document.getElementById('view-'+view).classList.add('view--active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('nav-item--active'));
  const navItem=document.querySelector(`.nav-item[data-view="${view}"]`);
  if(navItem)navItem.classList.add('nav-item--active');
  document.querySelector('.sidebar').classList.remove('open');
  window.scrollTo(0,0);
  // Render the view
  if(view==='dashboard')renderDashboard();
  else if(view==='calendar')renderFullCalendar();
  else if(view==='trades')renderTradesTable();
  else if(view==='analytics')renderAnalytics();
  else if(view==='playbooks')renderPlaybooks();
  else if(view==='insights')renderInsights();
  else if(view==='profile')renderProfile();
}

// ==================== CALCULATIONS ====================
function calcStats(trades){
  if(!trades.length)return{netPnl:0,winRate:0,profitFactor:0,totalTrades:0,wins:0,losses:0,avgWin:0,avgLoss:0,maxDD:0,bestTrade:0,worstTrade:0};
  let netPnl=0,wins=0,losses=0,grossProfit=0,grossLoss=0,maxDD=0,peak=-Infinity;
  let bestTrade=-Infinity,worstTrade=Infinity;
  const sorted=[...trades].sort((a,b)=>new Date(a.date)-new Date(b.date));
  sorted.forEach(t=>{
    netPnl+=t.pnl;peak=Math.max(peak,netPnl);maxDD=Math.min(maxDD,netPnl-peak);
    if(t.pnl>0){wins++;grossProfit+=t.pnl;}else{losses++;grossLoss+=Math.abs(t.pnl);}
    bestTrade=Math.max(bestTrade,t.pnl);worstTrade=Math.min(worstTrade,t.pnl);
  });
  return{netPnl:Math.round(netPnl*100)/100,winRate:Math.round(wins/trades.length*1000)/10,profitFactor:Math.round(grossProfit/grossLoss*100)/100,totalTrades:trades.length,wins,losses,avgWin:wins?Math.round(grossProfit/wins*100)/100:0,avgLoss:losses?Math.round(grossLoss/losses*100)/100:0,maxDD:Math.round(Math.abs(maxDD)*100)/100,bestTrade:Math.round(bestTrade*100)/100,worstTrade:Math.round(worstTrade*100)/100};
}

function groupByDate(trades){
  const map={};trades.forEach(t=>{if(!map[t.date])map[t.date]=[];map[t.date].push(t);});return map;
}
function groupBy(trades,key){
  const map={};trades.forEach(t=>{const k=t[key];if(!map[k])map[k]={trades:[],pnl:0};map[k].trades.push(t);map[k].pnl+=t.pnl;});return map;
}

// ==================== DASHBOARD ====================
function renderDashboard(){
  const stats=calcStats(state.trades);
  const startBal=state.settings.startBalance;
  // KPIs
  const kpiRow=document.getElementById('kpiRow');
  const kpis=[
    {label:'Net P&L',value:fmtPnl(stats.netPnl),hero:true,trend:stats.netPnl>=0?'up':'down',trendText:(stats.netPnl>=0?'▲ ':'▼ ')+Math.round(Math.abs(stats.netPnl)/startBal*100*10)/10+'%',sub:'vs start balance',dotColor:stats.netPnl>=0?'var(--profit)':'var(--loss)'},
    {label:'Win Rate',value:stats.winRate+'%',trend:'up',trendText:stats.wins+'W / '+stats.losses+'L',sub:''},
    {label:'Profit Factor',value:stats.profitFactor.toFixed(2),trend:stats.profitFactor>=1?'up':'down',trendText:'Gross P/L',sub:''},
    {label:'Total Trades',value:stats.totalTrades,trend:'up',trendText:'All time',sub:''},
    {label:'Avg Win',value:'+$'+fmt(stats.avgWin),color:'var(--profit-bright)',trend:'up',trendText:'per winning trade',sub:''},
    {label:'Avg Loss',value:'−$'+fmt(stats.avgLoss),color:'var(--loss-bright)',trend:'down',trendText:'per losing trade',sub:''},
    {label:'Highest Profit',value:'+$'+fmt(stats.bestTrade),color:'var(--profit-bright)',trend:'up',trendText:'best single trade',sub:''},
    {label:'Highest Loss',value:'−$'+fmt(stats.worstTrade),color:'var(--loss-bright)',trend:'down',trendText:'worst single trade',sub:''},
    {label:'Max Drawdown',value:'−$'+fmt(stats.maxDD),color:'var(--loss-bright)',trend:'down',trendText:(stats.maxDD/startBal*100).toFixed(1)+'% of acct',sub:'',dotColor:'var(--loss)'}
  ];
  kpiRow.innerHTML=kpis.map((k,i)=>`<div class="kpi-card ${k.hero?'kpi-card--hero':''}" style="--i:${i}"><div class="kpi-card__label"><span class="kpi-card__label-dot" style="background:${k.dotColor||'var(--profit)'}"></span>${k.label}</div><div class="kpi-card__value" style="${k.color?'color:'+k.color:''}">${k.value}</div><div class="kpi-card__sub"><span class="kpi-card__trend kpi-card__trend--${k.trend}">${k.trendText}</span>${k.sub}</div></div>`).join('');
  // Account balance
  document.getElementById('accountBalance').textContent='$'+(startBal+stats.netPnl).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // Date range
  if(state.trades.length){const dates=state.trades.map(t=>t.date).sort();document.getElementById('dashDateRange').textContent=fmtDate(dates[0])+' — '+fmtDate(dates[dates.length-1]);}
  // Nav badge
  document.getElementById('navTradeCount').textContent=state.trades.length;
  // Win/Loss
  document.getElementById('wlSubtitle').textContent=stats.totalTrades+' trades';
  document.getElementById('donutWinRate').textContent=stats.winRate+'%';
  document.getElementById('statWins').textContent=stats.wins;
  document.getElementById('statLosses').textContent=stats.losses;
  // Charts
  renderEquityChart();renderWinLossChart(stats);renderDailyPnlChart();renderSymbolList();
  // Mini calendar
  renderDashboardCalendar();
  // Recent trades
  const recent=state.trades.slice(0,8);
  document.getElementById('recentTradesBody').innerHTML=recent.map(t=>tradeRow(t,false)).join('');
}

function tradeRow(t,showActions=true){
  const isProfit=t.pnl>0;
  const actions=showActions?`<td><div class="trade-actions"><button onclick="editTrade(${t.id})" title="Edit"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button onclick="deleteTrade(${t.id})" title="Delete"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></td>`:'';
  return `<tr>
    <td><span class="symbol-badge"><span class="symbol-badge__dot" style="background:${getColor(t.symbol)}"></span>${t.symbol}</span></td>
    <td><span class="tag-side ${t.side==='Long'?'tag-long':'tag-short'}">${t.side}</span></td>
    <td><span class="tag-setup">${t.setup}</span></td>
    <td class="td-num td-mono">${t.entry.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}</td>
    <td class="td-num td-mono">${t.exit.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}</td>
    <td class="td-num td-mono">${t.qty}</td>
    <td class="td-num td-mono ${isProfit?'pnl-positive':'pnl-negative'}">${fmtPnl(t.pnl)}</td>
    <td class="td-num td-mono ${t.r>0?'pnl-positive':'pnl-negative'}">${t.r>0?'+':''}${t.r}R</td>
    <td class="td-mono" style="color:var(--text-dim)">${fmtDate(t.date)}</td>
    ${actions}
  </tr>`;
}

// ==================== CHARTS ====================
function destroyChart(name){if(charts[name]){charts[name].destroy();delete charts[name];}}

function renderEquityChart(){
  destroyChart('equity');
  const sorted=[...state.trades].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let cum=0;const data=sorted.map(t=>{cum+=t.pnl;return cum;});
  const labels=sorted.map(t=>fmtDate(t.date));
  const ctx=document.getElementById('equityChart');if(!ctx)return;
  charts.equity=new Chart(ctx,{type:'line',data:{labels,datasets:[{data,borderColor:'#10b981',backgroundColor:c=>{const ch=c.chart,area=ch.chartArea;if(!area)return'rgba(16,185,129,0.1)';const g=ch.ctx.createLinearGradient(0,area.top,0,area.bottom);g.addColorStop(0,'rgba(16,185,129,0.25)');g.addColorStop(1,'rgba(16,185,129,0)');return g;},fill:true,tension:0.35,borderWidth:2.5,pointRadius:0,pointHoverRadius:6,pointHoverBackgroundColor:'#34d399',pointHoverBorderColor:'#0b0f17',pointHoverBorderWidth:2}]},options:chartOpts({yFmt:v=>'$'+v.toLocaleString()})});
}

function renderWinLossChart(stats){
  destroyChart('winLoss');
  const ctx=document.getElementById('winLossChart');if(!ctx)return;
  charts.winLoss=new Chart(ctx,{type:'doughnut',data:{labels:['Winning','Losing'],datasets:[{data:[stats.wins,stats.losses],backgroundColor:['#10b981','#ef4444'],borderColor:'#131825',borderWidth:3,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'72%',plugins:{legend:{display:false},tooltip:ttOpts({label:c=>c.label+': '+c.parsed+' trades'})}}});
}

function renderDailyPnlChart(){
  destroyChart('dailyPnl');
  const byDate=groupByDate(state.trades);
  const dates=Object.keys(byDate).sort();
  const recent=dates.slice(-10);
  const data=recent.map(d=>Math.round(byDate[d].reduce((s,t)=>s+t.pnl,0)*100)/100);
  const labels=recent.map(d=>fmtDate(d));
  const ctx=document.getElementById('dailyPnlChart');if(!ctx)return;
  charts.dailyPnl=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:data.map(v=>v>0?'rgba(16,185,129,0.7)':'rgba(239,68,68,0.7)'),borderColor:data.map(v=>v>0?'#34d399':'#f87171'),borderWidth:1.5,borderRadius:5}]},options:chartOpts({yFmt:v=>(v>=0?'+':'−')+'$'+Math.abs(v),noXGrid:true})});
}

function renderSymbolList(){
  const bySymbol=groupBy(state.trades,'symbol');
  const arr=Object.entries(bySymbol).map(([k,v])=>({name:k,pnl:Math.round(v.pnl*100)/100,trades:v.trades.length})).sort((a,b)=>b.pnl-a.pnl);
  const maxAbs=Math.max(...arr.map(s=>Math.abs(s.pnl)),1);
  document.getElementById('symbolList').innerHTML=arr.map(s=>{
    const pct=Math.abs(s.pnl)/maxAbs*100;const isProfit=s.pnl>0;const sign=isProfit?'+':'−';
    return `<div class="symbol-row"><div class="symbol-row__name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getColor(s.name)};margin-right:6px;vertical-align:middle"></span>${s.name}</div><div class="symbol-row__bar-wrap"><div class="symbol-row__bar ${isProfit?'symbol-row__bar--profit':'symbol-row__bar--loss'}" style="width:${pct}%">${sign}$${fmt(s.pnl)}</div></div><div class="symbol-row__trades">${s.trades} trades</div></div>`;
  }).join('');
}

// Calendar for dashboard
function renderDashboardCalendar(){
  const now=new Date();const y=now.getFullYear();const m=now.getMonth();
  document.getElementById('calSubtitle').textContent=now.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  renderCalendarGrid('dashCalendar',y,m,false);
  renderCalSummary(y,m);
}
function renderCalSummary(y,m){
  const byDate=groupByDate(state.trades);
  let green=0,red=0,flat=0,best={pnl:-Infinity},worst={pnl:Infinity};
  state.trades.forEach(t=>{const d=new Date(t.date);if(d.getFullYear()===y&&d.getMonth()===m){const dayPnl=byDate[t.date].reduce((s,t)=>s+t.pnl,0);if(dayPnl>0)green++;else if(dayPnl<0)red++;if(dayPnl>best.pnl)best={pnl:dayPnl};if(dayPnl<worst.pnl)worst={pnl:dayPnl};}});
  document.getElementById('calSummary').innerHTML=`
    <div class="cal-sum-item"><div class="cal-sum-item__dot" style="background:var(--profit)"></div><div class="cal-sum-item__text"><strong>${green}</strong> Green days</div></div>
    <div class="cal-sum-item"><div class="cal-sum-item__dot" style="background:var(--loss)"></div><div class="cal-sum-item__text"><strong>${red}</strong> Red days</div></div>
    <div class="cal-sum-item"><div class="cal-sum-item__text">Best day: <strong style="color:var(--profit-bright)">${best.pnl>-Infinity?fmtPnl(best.pnl):'—'}</strong></div></div>
    <div class="cal-sum-item"><div class="cal-sum-item__text">Worst day: <strong style="color:var(--loss-bright)">${worst.pnl<Infinity?fmtPnl(worst.pnl):'—'}</strong></div></div>`;
}

function renderCalendarGrid(elId,y,m,interactive){
  const grid=document.getElementById(elId);if(!grid)return;
  const dayHeaders=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html=dayHeaders.map(d=>`<div class="calendar-day-header">${d}</div>`).join('');
  const first=new Date(y,m,1).getDay();const daysInMonth=new Date(y,m+1,0).getDate();
  const byDate=groupByDate(state.trades);
  for(let i=0;i<first;i++)html+='<div class="calendar-cell calendar-cell--empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayTrades=byDate[dateStr];
    const clk=interactive?' data-date="'+dateStr+'" onclick="showDayDetail(this.dataset.date)"':'';
    if(!dayTrades||!dayTrades.length){html+='<div class="calendar-cell calendar-cell--flat"'+clk+'><div class="calendar-cell__day">'+d+'</div></div>';continue;}
    const pnl=dayTrades.reduce((s,t)=>s+t.pnl,0);
    const abs=Math.abs(pnl);let cls='';
    if(pnl>0){if(abs>800)cls='profit-4';else if(abs>500)cls='profit-3';else if(abs>250)cls='profit-2';else cls='profit';}
    else{if(abs>500)cls='loss-4';else if(abs>300)cls='loss-3';else if(abs>150)cls='loss-2';else cls='loss';}
    const sign=pnl>0?'+':'−';
    html+='<div class="calendar-cell calendar-cell--'+cls+'"'+clk+'><div class="calendar-cell__day">'+d+'</div><div class="calendar-cell__pnl">'+sign+'$'+Math.round(abs)+'</div></div>';
  }
  grid.innerHTML=html;
}

// ==================== FULL CALENDAR ====================
function renderFullCalendar(){
  const m=state.calMonth,y=state.calYear;
  document.getElementById('calMonthLabel').textContent=new Date(y,m,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  renderCalendarGrid('fullCalendar',y,m,true);
  // Summary
  const byDate=groupByDate(state.trades);
  let green=0,red=0,totalPnl=0;
  state.trades.forEach(t=>{const d=new Date(t.date);if(d.getFullYear()===y&&d.getMonth()===m){const dp=byDate[t.date].reduce((s,t)=>s+t.pnl,0);if(dp>0)green++;else if(dp<0)red++;totalPnl+=dp;}});
  document.getElementById('fullCalSummary').innerHTML=`
    <div class="cal-sum-item"><div class="cal-sum-item__dot" style="background:var(--profit)"></div><div class="cal-sum-item__text"><strong>${green}</strong> Green days</div></div>
    <div class="cal-sum-item"><div class="cal-sum-item__dot" style="background:var(--loss)"></div><div class="cal-sum-item__text"><strong>${red}</strong> Red days</div></div>
    <div class="cal-sum-item"><div class="cal-sum-item__text">Month P&L: <strong style="color:${totalPnl>=0?'var(--profit-bright)':'var(--loss-bright)'}">${fmtPnl(totalPnl)}</strong></div></div>`;
}

function showDayDetail(dateStr){
  const byDate=groupByDate(state.trades);
  const trades=byDate[dateStr]||[];
  const card=document.getElementById('dayDetailCard');
  if(!trades.length){card.style.display='none';return;}
  const pnl=trades.reduce((s,t)=>s+t.pnl,0);
  document.getElementById('dayDetailTitle').textContent=fmtDate(dateStr)+' Details';
  document.getElementById('dayDetailSub').textContent=`${trades.length} trades · ${fmtPnl(pnl)} P&L`;
  document.getElementById('dayDetailBody').innerHTML=trades.map(t=>`<tr><td><span class="symbol-badge"><span class="symbol-badge__dot" style="background:${getColor(t.symbol)}"></span>${t.symbol}</span></td><td><span class="tag-side ${t.side==='Long'?'tag-long':'tag-short'}">${t.side}</span></td><td><span class="tag-setup">${t.setup}</span></td><td class="td-num td-mono ${t.pnl>0?'pnl-positive':'pnl-negative'}">${fmtPnl(t.pnl)}</td><td class="td-num td-mono ${t.r>0?'pnl-positive':'pnl-negative'}">${t.r>0?'+':''}${t.r}R</td><td style="font-size:12px;color:var(--text-dim)">${t.notes||'—'}</td></tr>`).join('');
  card.style.display='block';
}

// ==================== TRADES TABLE ====================
function renderTradesTable(){
  // Populate filter dropdowns
  const symbols=[...new Set(state.trades.map(t=>t.symbol))].sort();
  const setups=[...new Set(state.trades.map(t=>t.setup))].sort();
  const symSel=document.getElementById('filterSymbol');
  symSel.innerHTML='<option value="">All Symbols</option>'+symbols.map(s=>`<option>${s}</option>`).join('');
  const setupSel=document.getElementById('filterSetup');
  setupSel.innerHTML='<option value="">All Setups</option>'+setups.map(s=>`<option>${s}</option>`).join('');
  // Filter
  let filtered=state.trades.filter(t=>{
    if(state.filters.search&&!t.symbol.toLowerCase().includes(state.filters.search.toLowerCase()))return false;
    if(state.filters.side&&t.side!==state.filters.side)return false;
    if(state.filters.setup&&t.setup!==state.filters.setup)return false;
    if(state.filters.symbol&&t.symbol!==state.filters.symbol)return false;
    return true;
  });
  // Sort
  filtered.sort((a,b)=>{
    let av=a[state.sortKey],bv=b[state.sortKey];
    if(typeof av==='string'){return state.sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av);}
    return state.sortDir==='asc'?av-bv:bv-av;
  });
  document.getElementById('tradesCount').textContent=filtered.length+' trades';
  const body=document.getElementById('allTradesBody');
  if(!filtered.length){
    body.innerHTML=`<tr><td colspan="10"><div class="empty-state"><div class="empty-state__icon"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div><div class="empty-state__title">No trades found</div><div class="empty-state__text">Try adjusting filters or add a new trade.</div></div></td></tr>`;
    return;
  }
  body.innerHTML=filtered.map(t=>tradeRow(t,true)).join('');
  // Update sort indicators
  document.querySelectorAll('.trades-table th[data-sort]').forEach(th=>{
    th.classList.toggle('sorted',th.dataset.sort===state.sortKey);
    th.textContent=th.textContent.replace(/[↑↓]$/,'').trim()+(th.dataset.sort===state.sortKey?(state.sortDir==='asc'?' ↑':' ↓'):'');
  });
}

// ==================== TRADE CRUD ====================
function openTradeModal(id){
  const modal=document.getElementById('tradeModal');
  document.getElementById('modalTitle').textContent=id?'Edit Trade':'Add Trade';
  document.getElementById('tradeForm').reset();
  document.getElementById('tradeId').value='';
  document.getElementById('fDate').value=new Date().toISOString().split('T')[0];
  if(id){const t=state.trades.find(x=>x.id===id);if(t){
    document.getElementById('tradeId').value=t.id;
    document.getElementById('fSymbol').value=t.symbol;
    document.getElementById('fSide').value=t.side;
    document.getElementById('fSetup').value=t.setup;
    document.getElementById('fDate').value=t.date;
    document.getElementById('fEntry').value=t.entry;
    document.getElementById('fExit').value=t.exit;
    document.getElementById('fQty').value=t.qty;
    document.getElementById('fRisk').value=Math.abs(t.entry*t.qty*0.005).toFixed(2);
    document.getElementById('fNotes').value=t.notes||'';
  }}
  modal.classList.add('active');
}
function closeTradeModal(){document.getElementById('tradeModal').classList.remove('active');}
function saveTrade(){
  const id=parseInt(document.getElementById('tradeId').value)||Date.now();
  const symbol=document.getElementById('fSymbol').value.toUpperCase();
  const side=document.getElementById('fSide').value;
  const setup=document.getElementById('fSetup').value;
  const date=document.getElementById('fDate').value;
  const entry=parseFloat(document.getElementById('fEntry').value);
  const exit=parseFloat(document.getElementById('fExit').value);
  const qty=parseInt(document.getElementById('fQty').value);
  const riskVal=parseFloat(document.getElementById('fRisk').value)||Math.abs(entry*qty*0.005);
  const notes=document.getElementById('fNotes').value;
  if(!symbol||!entry||!exit||!qty||!date){toast('Please fill all required fields','error');return;}
  const pnl=Math.round((exit-entry)*qty*(side==='Long'?1:-1)*100)/100;
  const r=Math.round(pnl/riskVal*100)/100;
  const existing=state.trades.find(t=>t.id===id);
  if(existing){Object.assign(existing,{symbol,side,setup,entry,exit,qty,pnl,r,date,notes});}
  else{state.trades.push({id,symbol,side,setup,entry,exit,qty,pnl,r,date,notes});}
  state.trades.sort((a,b)=>new Date(b.date)-new Date(a.date));
  saveState();closeTradeModal();
  if(currentUser){const t=state.trades.find(x=>x.id===id);if(t)syncPushTrade(t);}
  toast(existing?'Trade updated':'Trade added','success');
  refreshCurrentView();
}
function editTrade(id){openTradeModal(id);}
function deleteTrade(id){
  if(!confirm('Delete this trade?'))return;
  state.trades=state.trades.filter(t=>t.id!==id);
  saveState();if(currentUser)syncDeleteTrade(id);toast('Trade deleted','info');refreshCurrentView();
}
function deleteAllTrades(){
  if(!confirm('Delete ALL trades? This cannot be undone.'))return;
  state.trades=[];saveState();toast('All trades deleted','info');refreshCurrentView();
}
function resetData(){
  if(!confirm('Reset to sample data? Your current trades will be replaced.'))return;
  seedData();toast('Sample data restored','success');refreshCurrentView();
}

// ==================== ANALYTICS ====================
function renderAnalytics(){
  const stats=calcStats(state.trades);
  // Day of week
  destroyChart('dow');destroyChart('setup');destroyChart('drawdown');destroyChart('streak');destroyChart('symbol');
  const dowNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowPnl=[0,0,0,0,0,0,0];const dowCounts=[0,0,0,0,0,0,0];
  state.trades.forEach(t=>{const d=new Date(t.date).getDay();dowPnl[d]+=t.pnl;dowCounts[d]++;});
  const dowCtx=document.getElementById('dowChart');if(dowCtx){
    var dowPnlR=dowPnl.map(function(v){return Math.round(v*100)/100;});
    charts.dow=new Chart(dowCtx,{type:'bar',data:{labels:dowNames,datasets:[{data:dowPnlR,backgroundColor:dowPnlR.map(function(v){return v>0?'rgba(16,185,129,0.7)':'rgba(239,68,68,0.7)';}),borderColor:dowPnlR.map(function(v){return v>0?'#34d399':'#f87171';}),borderWidth:1.5,borderRadius:5}]},options:chartOpts({yFmt:function(v){return '$'+Math.round(v).toLocaleString();},noXGrid:true})});
  }
  // Setup type
  const bySetup=groupBy(state.trades,'setup');
  const setupLabels=Object.keys(bySetup);const setupPnl=setupLabels.map(s=>Math.round(bySetup[s].pnl*100)/100);
  const setupCtx=document.getElementById('setupChart');if(setupCtx){
    charts.setup=new Chart(setupCtx,{type:'bar',data:{labels:setupLabels,datasets:[{data:setupPnl,backgroundColor:setupPnl.map(v=>v>0?'rgba(16,185,129,0.7)':'rgba(239,68,68,0.7)'),borderColor:setupPnl.map(v=>v>0?'#34d399':'#f87171'),borderWidth:1.5,borderRadius:5}]},options:chartOpts({yFmt:v=>'$'+v,noXGrid:true,indexAxis:'y'})});
  }
  // Drawdown
  const sorted=[...state.trades].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let cum=0,peak=0;const ddData=sorted.map(t=>{cum+=t.pnl;peak=Math.max(peak,cum);return cum-peak;});
  const ddCtx=document.getElementById('drawdownChart');if(ddCtx){
    charts.drawdown=new Chart(ddCtx,{type:'line',data:{labels:sorted.map(t=>fmtDate(t.date)),datasets:[{data:ddData,borderColor:'#ef4444',backgroundColor:'rgba(239,68,68,0.1)',fill:true,tension:0.3,borderWidth:2,pointRadius:0}]},options:chartOpts({yFmt:v=>'$'+v})});
  }
  // Streaks
  let curWin=0,curLoss=0,maxWin=0,maxLoss=0;
  const streakData=[];sorted.forEach(t=>{
    if(t.pnl>0){curWin++;curLoss=0;maxWin=Math.max(maxWin,curWin);}
    else{curLoss++;curWin=0;maxLoss=Math.max(maxLoss,curLoss);}
    streakData.push(curWin-curLoss);
  });
  const streakCtx=document.getElementById('streakChart');if(streakCtx){
    charts.streak=new Chart(streakCtx,{type:'bar',data:{labels:sorted.map(t=>fmtDate(t.date)),datasets:[{data:streakData,backgroundColor:streakData.map(v=>v>0?'rgba(16,185,129,0.5)':'rgba(239,68,68,0.5)'),borderRadius:3}]},options:chartOpts({yFmt:v=>v,noXGrid:true})});
  }
  // Symbol
  const bySymbol=groupBy(state.trades,'symbol');
  const symLabels=Object.keys(bySymbol);const symPnl=symLabels.map(s=>Math.round(bySymbol[s].pnl*100)/100);
  const symCtx=document.getElementById('symbolChart');if(symCtx){
    charts.symbol=new Chart(symCtx,{type:'bar',data:{labels:symLabels,datasets:[{data:symPnl,backgroundColor:symLabels.map(s=>getColor(s)+'99'),borderColor:symLabels.map(s=>getColor(s)),borderWidth:1.5,borderRadius:5}]},options:chartOpts({yFmt:v=>'$'+v,noXGrid:true})});
  }
}

// ==================== PLAYBOOKS ====================
function renderPlaybooks(){
  const setups=['Breakout','Pullback','Reversal','Breakdown','Trend Following','Scalp','Swing'];
  const grid=document.getElementById('playbookGrid');
  grid.innerHTML=setups.map((setup,i)=>{
    const trades=state.trades.filter(t=>t.setup===setup);
    const wins=trades.filter(t=>t.pnl>0).length;
    const losses=trades.filter(t=>t.pnl<=0).length;
    const pnl=trades.reduce((s,t)=>s+t.pnl,0);
    const winRate=trades.length?Math.round(wins/trades.length*100):0;
    const tagColor=winRate>=60?'var(--profit)':winRate>=40?'var(--accent)':'var(--loss)';
    const tagBg=winRate>=60?'var(--profit-dim)':winRate>=40?'var(--accent-dim)':'var(--loss-dim)';
    const rules=getPlaybookRules(setup);
    return `<div class="playbook-card" style="--i:${i}">
      <div class="playbook-card__header"><div class="playbook-card__name">${setup}</div><span class="playbook-card__tag" style="background:${tagBg};color:${tagColor}">${winRate}% WR</span></div>
      <div class="playbook-card__desc">${getPlaybookDesc(setup)}</div>
      <div class="playbook-card__stats">
        <div class="pb-stat"><div class="pb-stat__value ${pnl>=0?'pb-stat__value--green':'pb-stat__value--red'}">${fmtPnl(pnl)}</div><div class="pb-stat__label">Net P&L</div></div>
        <div class="pb-stat"><div class="pb-stat__value">${trades.length}</div><div class="pb-stat__label">Trades</div></div>
        <div class="pb-stat"><div class="pb-stat__value">${wins}/${losses}</div><div class="pb-stat__label">W/L</div></div>
      </div>
      <ul class="playbook-card__rules" style="margin-top:16px">${rules.map(r=>`<li>${r}</li>`).join('')}</ul>
    </div>`;
  }).join('');
}
function getPlaybookDesc(setup){
  const descs={'Breakout':'Enter when price breaks above a key resistance level with volume confirmation. Works well on US30 and NAS100.','Pullback':'Buy dips in an established uptrend at support or moving average. Common in EUR/USD and GBP/USD.','Reversal':'Counter-trend trade at key levels when momentum diverges. Use on Gold and major forex pairs.','Breakdown':'Short when price breaks below support with volume confirmation. Effective on indices and commodities.','Trend Following':'Follow the established trend using higher timeframe confirmation. Ideal for Dow Jones and S&P 500.','Scalp':'Quick in-and-out trades capturing small moves with tight spreads. Best on EUR/USD and GBP/USD.','Swing':'Multi-day positions capturing larger market swings. Works on all instruments including crypto.'};
  return descs[setup]||'Custom trading strategy.';
}
function getPlaybookRules(setup){
  const rules={'Breakout':['Wait for candle close above resistance','Volume must be >1.5x average','Stop loss below breakout candle','Target: 2R minimum'],'Pullback':['Trend must be clearly established','Wait for pullback to 20 EMA','Look for bullish reversal candle','Risk: 1% of account'],'Reversal':['Only at major S/R levels','RSI divergence required','Wait for confirmation candle','Smaller position size (0.5%)'],'Breakdown':['Wait for candle close below support','Volume must be >1.5x average','Stop loss above breakdown candle','Target: 2R minimum'],'Trend Following':['Higher highs/higher lows confirmed','Trade in direction of higher TF','Trail stop behind structure','Let winners run, cut losers fast'],'Scalp':['Only during London/NY session overlap','Tight spread pairs only (EUR/USD, GBP/USD)','Max hold time: 15 minutes','Risk: 0.25% per trade'],'Swing':['Daily/4H chart setup required','Hold 2-10 days typically','Risk: 1-2% of account','Target: 3-5R minimum']};
  return rules[setup]||['Define your entry rules','Set clear stop loss','Define profit target','Journal every trade'];
}
function addPlaybook(){toast('Playbook editor coming soon','info');}

// ==================== PROFILE ====================
function renderProfile(){
  if(!currentUser){return;}
  const stats=calcStats(state.trades);
  const email=currentUser.email||'user@example.com';
  const username=email.split('@')[0];
  const initials=username.substring(0,2).toUpperCase();
  const createdAt=currentUser.created_at?new Date(currentUser.created_at).toLocaleDateString('en-US',{month:'short',year:'numeric'}):'Sep 2026';
  const provider=currentUser.app_metadata&&currentUser.app_metadata.provider?currentUser.app_metadata.provider:'email';
  const userId=currentUser.id?currentUser.id.substring(0,8):'unknown';
  // Header
  document.getElementById('profileAvatarLG').textContent=initials;
  document.getElementById('profileName').textContent=username.charAt(0).toUpperCase()+username.slice(1);
  document.getElementById('profileEmail').textContent=email;
  document.getElementById('profileJoined').textContent='Member since '+createdAt;
  document.getElementById('profilePlanBadge').textContent='FREE PLAN';
  // Stats grid
  const statsGrid=document.getElementById('profileStatsGrid');
  statsGrid.innerHTML=
    '<div class="profile-stat"><div class="profile-stat__value '+(stats.netPnl>=0?'profile-stat__value--green':'profile-stat__value--red')+'">'+fmtPnl(stats.netPnl)+'</div><div class="profile-stat__label">Net P&L</div></div>'+
    '<div class="profile-stat"><div class="profile-stat__value">'+stats.winRate+'%</div><div class="profile-stat__label">Win Rate</div></div>'+
    '<div class="profile-stat"><div class="profile-stat__value">'+stats.totalTrades+'</div><div class="profile-stat__label">Total Trades</div></div>'+
    '<div class="profile-stat"><div class="profile-stat__value '+(stats.netPnl>=0?'profile-stat__value--green':'profile-stat__value--red')+'">'+stats.profitFactor.toFixed(2)+'</div><div class="profile-stat__label">Profit Factor</div></div>'+
    '<div class="profile-stat"><div class="profile-stat__value profile-stat__value--red">$'+fmt(stats.maxDD)+'</div><div class="profile-stat__label">Max DD</div></div>'+
    '<div class="profile-stat"><div class="profile-stat__value">'+stats.wins+'/'+stats.losses+'</div><div class="profile-stat__label">W / L</div></div>';
  // Account info
  document.getElementById('profileInfoRows').innerHTML=
    '<div class="profile-info-row"><div class="profile-info-row__label">User ID</div><div class="profile-info-row__value">'+userId+'...</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Email</div><div class="profile-info-row__value">'+email+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Sign-in Method</div><div class="profile-info-row__value" style="text-transform:capitalize">'+provider+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Account Name</div><div class="profile-info-row__value">'+state.settings.accountName+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Starting Balance</div><div class="profile-info-row__value">$'+state.settings.startBalance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Current Balance</div><div class="profile-info-row__value" style="color:var(--profit-bright)">$'+(state.settings.startBalance+stats.netPnl).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Currency</div><div class="profile-info-row__value">'+state.settings.currency+'</div></div>';
  // Subscription
  document.getElementById('profileSubscription').innerHTML=
    '<div class="profile-info-row"><div class="profile-info-row__label">Current Plan</div><div class="profile-info-row__value"><span class="profile-plan-badge profile-plan-badge--free">FREE</span></div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Trade Limit</div><div class="profile-info-row__value">Unlimited</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Features</div><div class="profile-info-row__value">Dashboard, Calendar, Trades</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Pro Features</div><div class="profile-info-row__value" style="color:var(--text-dim)">Locked - Upgrade to unlock</div></div>';
  // Quick actions
  const bySymbol=groupBy(state.trades,'symbol');
  const bySetup=groupBy(state.trades,'setup');
  document.getElementById('profileActions').innerHTML=
    '<div class="profile-info-row"><div class="profile-info-row__label">Symbols Traded</div><div class="profile-info-row__value">'+Object.keys(bySymbol).length+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Setups Used</div><div class="profile-info-row__value">'+Object.keys(bySetup).length+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Best Trade</div><div class="profile-info-row__value" style="color:var(--profit-bright)">'+fmtPnl(stats.bestTrade)+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Worst Trade</div><div class="profile-info-row__value" style="color:var(--loss-bright)">'+fmtPnl(stats.worstTrade)+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Avg Win</div><div class="profile-info-row__value" style="color:var(--profit-bright)">+$'+fmt(stats.avgWin)+'</div></div>'+
    '<div class="profile-info-row"><div class="profile-info-row__label">Avg Loss</div><div class="profile-info-row__value" style="color:var(--loss-bright)">\u2212$'+fmt(stats.avgLoss)+'</div></div>';
}

// ==================== AI INSIGHTS ====================
function renderInsights(){
  const stats=calcStats(state.trades);
  const bySymbol=groupBy(state.trades,'symbol');
  const bySetup=groupBy(state.trades,'setup');
  const insights=[];
  // Best symbol
  const symArr=Object.entries(bySymbol).map(([k,v])=>({name:k,pnl:v.pnl,trades:v.trades.length})).sort((a,b)=>b.pnl-a.pnl);
  if(symArr.length){
    const best=symArr[0],worst=symArr[symArr.length-1];
    insights.push({type:'success',title:'Most Profitable Symbol',text:`Your best performing symbol is <strong>${best.name}</strong> with ${fmtPnl(best.pnl)} across ${best.trades} trades. Consider increasing position size here.`});
    if(worst.pnl<0)insights.push({type:'warning',title:'Underperforming Symbol',text:`<strong>${worst.name}</strong> is your worst symbol at ${fmtPnl(worst.pnl)} across ${worst.trades} trades. Review your setup or reduce exposure.`});
  }
  // Best setup
  const setupArr=Object.entries(bySetup).map(([k,v])=>({name:k,pnl:v.pnl,trades:v.trades.length,wr:Math.round(v.trades.filter(t=>t.pnl>0).length/v.trades.length*100)})).sort((a,b)=>b.pnl-a.pnl);
  if(setupArr.length){
    const best=setupArr[0];
    insights.push({type:'success',title:'Best Strategy',text:`Your <strong>${best.name}</strong> setup has the highest net P&L at ${fmtPnl(best.pnl)} with a ${best.wr}% win rate across ${best.trades} trades.`});
  }
  // Win rate
  if(stats.winRate>=60)insights.push({type:'success',title:'Strong Win Rate',text:`Your win rate of ${stats.winRate}% is above average. Your edge is working well — maintain discipline.`});
  else if(stats.winRate<40)insights.push({type:'warning',title:'Win Rate Below Target',text:`Your win rate is ${stats.winRate}%. Focus on trade quality over quantity. Consider waiting for A+ setups only.`});
  // Profit factor
  if(stats.profitFactor>=2)insights.push({type:'success',title:'Excellent Profit Factor',text:`Your profit factor of ${stats.profitFactor} means you make $${stats.profitFactor} for every $1 lost. This is a sustainable edge.`});
  else if(stats.profitFactor<1)insights.push({type:'warning',title:'Profit Factor Below 1.0',text:`Your profit factor is ${stats.profitFactor}, meaning you're losing more than you make. Review your risk management and trade selection.`});
  // Day of week
  const dowPnl=[0,0,0,0,0,0,0];const dowCounts=[0,0,0,0,0,0,0];
  state.trades.forEach(t=>{const d=new Date(t.date).getDay();dowPnl[d]+=t.pnl;dowCounts[d]++;});
  const dowNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let bestDow={pnl:-Infinity,day:''},worstDow={pnl:Infinity,day:''};
  for(let i=0;i<7;i++){if(dowCounts[i]>0){if(dowPnl[i]>bestDow.pnl)bestDow={pnl:dowPnl[i],day:dowNames[i]};if(dowPnl[i]<worstDow.pnl)worstDow={pnl:dowPnl[i],day:dowNames[i]};}}
  if(bestDow.day){let txt='You perform best on <strong>'+bestDow.day+'</strong> with '+fmtPnl(bestDow.pnl)+' P&L.';if(worstDow.pnl<0){txt+=' Avoid trading on '+worstDow.day+' where you lose '+fmtPnl(worstDow.pnl)+'.';}insights.push({type:'info',title:'Best Trading Day',text:txt});}
  // Drawdown
  if(stats.maxDD>state.settings.maxDailyLoss*2)insights.push({type:'warning',title:'Large Drawdown Detected',text:`Your max drawdown of $${fmt(stats.maxDD)} exceeds 2x your daily loss limit. Consider reducing position sizes during losing streaks.`});
  // Avg win vs loss
  if(stats.avgWin>0&&stats.avgLoss>0){
    const ratio=stats.avgWin/stats.avgLoss;
    if(ratio>=1.5)insights.push({type:'success',title:'Healthy R:R Ratio',text:`Your average win ($${fmt(stats.avgWin)}) is ${ratio.toFixed(1)}x your average loss ($${fmt(stats.avgLoss)}). This rewards your winning trades.`});
    else insights.push({type:'warning',title:'Tight R:R Ratio',text:`Your average win ($${fmt(stats.avgWin)}) is only ${ratio.toFixed(1)}x your average loss ($${fmt(stats.avgLoss)}). Consider letting winners run longer.`});
  }
  const colors={success:'var(--profit)',warning:'var(--loss)',info:'var(--info)'};
  const bgs={success:'var(--profit-dim)',warning:'var(--loss-dim)',info:'var(--info-dim)'};
  document.getElementById('insightsContainer').innerHTML=insights.map(ins=>`
    <div class="chart-card" style="border-left:3px solid ${colors[ins.type]};margin-bottom:16px">
      <div style="display:flex;align-items:start;gap:16px">
        <div style="width:40px;height:40px;border-radius:10px;background:${bgs[ins.type]};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${colors[ins.type]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${ins.type==='success'?'<polyline points="20 6 9 17 4 12"/>':'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
          </svg>
        </div>
        <div><div style="font-size:14px;font-weight:700;color:var(--text-bright);margin-bottom:6px">${ins.title}</div><div style="font-size:13px;color:var(--text-dim);line-height:1.6">${ins.text}</div></div>
      </div>
    </div>`).join('');
}

// ==================== EXPORT ====================
function exportTrades(){
  const headers=['Symbol','Side','Setup','Date','Entry','Exit','Qty','PnL','R','Notes'];
  const rows=state.trades.map(t=>[t.symbol,t.side,t.setup,t.date,t.entry,t.exit,t.qty,t.pnl,t.r,t.notes||'']);
  const csv=[headers.join(','),...rows.map(r=>r.map(c=>`"${c}"`).join(','))].join('\n');
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='trades_export.csv';a.click();URL.revokeObjectURL(url);
  toast('Trades exported','success');
}

// ==================== SETTINGS ====================
function saveSettings(){
  state.settings.accountName=document.getElementById('setAccountName').value;
  state.settings.startBalance=parseFloat(document.getElementById('setStartBalance').value)||50000;
  state.settings.currency=document.getElementById('setCurrency').value;
  state.settings.maxDailyLoss=parseFloat(document.getElementById('setMaxDailyLoss').value)||1000;
  state.settings.maxDailyTrades=parseInt(document.getElementById('setMaxTrades').value)||20;
  state.settings.riskPerTrade=parseFloat(document.getElementById('setRiskPerTrade').value)||2;
  saveState();if(currentUser)syncPushSettings();toast('Settings saved','success');refreshCurrentView();
}
function loadSettingsForm(){
  document.getElementById('setAccountName').value=state.settings.accountName;
  document.getElementById('setStartBalance').value=state.settings.startBalance;
  document.getElementById('setCurrency').value=state.settings.currency;
  document.getElementById('setMaxDailyLoss').value=state.settings.maxDailyLoss;
  document.getElementById('setMaxTrades').value=state.settings.maxDailyTrades;
  document.getElementById('setRiskPerTrade').value=state.settings.riskPerTrade;
}

// ==================== HELPERS ====================
function chartOpts(opts={}){
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  const textColor=isLight?'#6f6a60':'#8b929e';const gridColor=isLight?'rgba(28,24,16,0.06)':'rgba(255,255,255,0.05)';
  const fontFamily="'Inter', sans-serif";
  return{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a2030',borderColor:'rgba(255,255,255,0.12)',borderWidth:1,titleColor:'#f4f7fb',bodyColor:'#e6edf3',padding:12,cornerRadius:8,titleFont:{family:fontFamily,size:12,weight:'600'},bodyFont:{family:fontFamily,size:13},callbacks:{label:c=>{const v=c.parsed.y;if(opts.yFmt)return opts.yFmt(v);return v;}}}},scales:{x:{grid:{display:opts.noXGrid?false:false},ticks:{color:textColor,font:{family:fontFamily,size:11},maxRotation:45,autoSkip:true,maxTicksLimit:10},border:{color:gridColor}},y:{grid:{color:gridColor},ticks:{color:textColor,font:{family:fontFamily,size:11},callback:v=>opts.yFmt?opts.yFmt(v):v},border:{display:false}}}};
}
function ttOpts(cb){return{backgroundColor:'#1a2030',borderColor:'rgba(255,255,255,0.12)',borderWidth:1,titleColor:'#f4f7fb',bodyColor:'#e6edf3',padding:12,cornerRadius:8,callbacks:{label:cb}};}
function toast(msg,type='info'){const t=document.getElementById('toast');t.className='toast toast--'+type;document.getElementById('toastText').textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function refreshCurrentView(){const active=document.querySelector('.view--active');if(!active)return;const view=active.id.replace('view-','');if(view==='dashboard')renderDashboard();else if(view==='calendar')renderFullCalendar();else if(view==='trades')renderTradesTable();else if(view==='analytics')renderAnalytics();else if(view==='playbooks')renderPlaybooks();else if(view==='insights')renderInsights();else if(view==='profile')renderProfile();}

// ==================== INIT ====================
function toggleTheme(){
  var current=document.documentElement.getAttribute('data-theme')||'light';
  var newTheme=current==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',newTheme);
  try{localStorage.setItem('tfj_theme2',newTheme);}catch(e){}
  if(typeof refreshCurrentView==='function')refreshCurrentView();
}
function initTheme(){
  var saved='light';
  try{saved=localStorage.getItem('tfj_theme2')||'light';}catch(e){}
  document.documentElement.setAttribute('data-theme',saved);
}
initTheme();

document.addEventListener('DOMContentLoaded',async()=>{
  // Nav clicks
  document.querySelectorAll('.nav-item[data-view]').forEach(item=>{
    item.addEventListener('click',()=>switchView(item.dataset.view));
  });
  // Calendar nav
  document.getElementById('calPrev').addEventListener('click',()=>{state.calMonth--;if(state.calMonth<0){state.calMonth=11;state.calYear--;}renderFullCalendar();});
  document.getElementById('calNext').addEventListener('click',()=>{state.calMonth++;if(state.calMonth>11){state.calMonth=0;state.calYear++;}renderFullCalendar();});
  document.getElementById('calToday').addEventListener('click',()=>{const now=new Date();state.calMonth=now.getMonth();state.calYear=now.getFullYear();renderFullCalendar();});
  // Filters
  document.getElementById('searchInput').addEventListener('input',e=>{state.filters.search=e.target.value;renderTradesTable();});
  document.getElementById('filterSide').addEventListener('change',e=>{state.filters.side=e.target.value;renderTradesTable();});
  document.getElementById('filterSetup').addEventListener('change',e=>{state.filters.setup=e.target.value;renderTradesTable();});
  document.getElementById('filterSymbol').addEventListener('change',e=>{state.filters.symbol=e.target.value;renderTradesTable();});
  // Sort
  document.querySelectorAll('.trades-table th[data-sort]').forEach(th=>{th.addEventListener('click',()=>{const key=th.dataset.sort;if(state.sortKey===key){state.sortDir=state.sortDir==='asc'?'desc':'asc';}else{state.sortKey=key;state.sortDir='desc';}renderTradesTable();});});
  // Modal close on overlay
  document.getElementById('tradeModal').addEventListener('click',e=>{if(e.target.id==='tradeModal')closeTradeModal();});
  // Keyboard
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTradeModal();if(e.key==='n'&&e.ctrlKey){e.preventDefault();openTradeModal();}});
  
  // === AUTH INIT ===
  const supabaseReady = initSupabase();
  if(supabaseReady){
    // Check if user is already logged in (session persistence)
    const { data: { session } } = await supabaseClient.auth.getSession();
    if(session && session.user){
      currentUser = session.user;
      showApp();
    } else {
      // Not logged in — show auth screen
      document.getElementById('authScreen').classList.remove('hidden');
      document.getElementById('mainApp').style.display = 'none';
    }
    // Listen for auth state changes
    supabaseClient.auth.onAuthStateChange((event, session)=>{
      if(event === 'SIGNED_OUT' || !session){
        currentUser = null;
        document.getElementById('authScreen').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
      } else if(session && session.user){
        currentUser = session.user;
      }
    });
  } else {
    // Demo mode — no auth, go straight to app
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').style.display = 'grid';
    loadSettingsForm();
    if(!loadState()||!state.trades.length){seedData();}
    renderDashboard();
  }
});
