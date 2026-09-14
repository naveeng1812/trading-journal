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
  if(!state.trades.length){ seedData(); }
  loadSettingsForm();
  renderDashboard();
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
function getColor(symbol){return SYMBOL_COLORS[symbol] || '#7a8599';{
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
    {label:'Net P&L',value:fmtPnl(stats.netPnl),hero:true,trend:stats.netPnl>=0?'up':'down',trendText:(stats.netPnl>=0?'▲ ':'▼ ')+Math.round(Math.abs(stats.netPnl)/startBal*100*10)/10+'%',sub:'vs start balance',dotCol