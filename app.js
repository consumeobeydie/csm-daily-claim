import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.2.3';
import { BrowserProvider, Contract, formatUnits } from 'https://esm.sh/ethers@6.13.4';

const CONFIG = {
  chainId: 8453,
  rpcUrl: 'https://mainnet.base.org',
  tokenAddress: '0x9ECF496059E601ca541712319d34fa053602289D',
  claimAddress: '0x8aE6bF520DdF004b8b38F2314d4D7de9afD46110',
};

const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const CLAIM_ABI = [
  'function claim()',
  'function getClaimInfo(address) view returns (uint8 claimsUsed, uint8 claimsRemaining, uint256 nextResetTimestamp, bool canClaimNow)',
];

const $ = (id) => document.getElementById(id);
const connectBtn = $('connect-btn');
const claimBtn = $('claim-btn');
const balanceEl = $('balance');
const claimsEl = $('claims-remaining');
const countdownEl = $('countdown');
const statusEl = $('status');
const walletEl = $('wallet-address');

let provider = null;
let signer = null;
let account = null;
let tokenContract = null;
let claimContract = null;
let claimInfo = null;
let countdownTimer = null;

void sdk.actions.ready().catch(() => {});

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` ${type}` : ''}`;
}

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatBalance(raw, decimals) {
  const num = Number(formatUnits(raw, decimals));
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatCountdown(seconds) {
  if (seconds <= 0) return 'Ready';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateClaimsUI() {
  if (!claimInfo) {
    claimsEl.textContent = '0/3';
    countdownEl.textContent = '—';
    claimBtn.disabled = true;
    return;
  }
  const used = Number(claimInfo.claimsUsed);
  claimsEl.textContent = `${used}/3`;
  const now = Math.floor(Date.now() / 1000);
  const resetAt = Number(claimInfo.nextResetTimestamp);
  if (used >= 3 && resetAt > now) {
    countdownEl.textContent = formatCountdown(resetAt - now);
    claimBtn.disabled = true;
  } else if (claimInfo.canClaimNow && account) {
    countdownEl.textContent = 'Ready';
    claimBtn.disabled = false;
  } else {
    countdownEl.textContent = '—';
    claimBtn.disabled = true;
  }
}

function startCountdownLoop() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateClaimsUI, 1000);
}

async function refreshBalance() {
  if (!tokenContract || !account) { balanceEl.textContent = '—'; return; }
  try {
    const [raw, decimals] = await Promise.all([
      tokenContract.balanceOf(account),
      tokenContract.decimals(),
    ]);
    balanceEl.textContent = formatBalance(raw, decimals);
  } catch { balanceEl.textContent = '—'; }
}

async function refreshClaimInfo() {
  if (!claimContract || !account) { claimInfo = null; updateClaimsUI(); return; }
  try {
    const result = await claimContract.getClaimInfo(account);
    claimInfo = {
      claimsUsed: result[0],
      claimsRemaining: result[1],
      nextResetTimestamp: result[2],
      canClaimNow: result[3],
    };
  } catch { claimInfo = null; }
  updateClaimsUI();
}

async function getWalletProvider() {
  // Try Farcaster SDK embedded wallet first
  try {
    const fcProvider = await sdk.wallet.getEthereumProvider();
    if (fcProvider && typeof fcProvider.request === 'function') {
      return fcProvider;
    }
  } catch { /* not in mini app */ }

  // Fallback to MetaMask / Coinbase Wallet
  if (window.ethereum) return window.ethereum;

  throw new Error('No wallet found. Install MetaMask or open in Base App.');
}

async function connectWallet() {
  connectBtn.textContent = 'Connecting…';
  connectBtn.disabled = true;
  setStatus('Connecting…');

  try {
    const ethProvider = await getWalletProvider();

    // Base App already has accounts, no approval needed
    let accounts = await ethProvider.request({ method: 'eth_accounts' });
    
    // If no accounts, try requesting
    if (!accounts || accounts.length === 0) {
      accounts = await ethProvider.request({ method: 'eth_requestAccounts' });
    }

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found. Please approve wallet connection.');
    }

    provider = new BrowserProvider(ethProvider);
    signer = await provider.getSigner(accounts[0]);
    account = accounts[0];

    tokenContract = new Contract(CONFIG.tokenAddress, TOKEN_ABI, signer);
    claimContract = new Contract(CONFIG.claimAddress, CLAIM_ABI, signer);

    walletEl.hidden = false;
    walletEl.textContent = shortAddress(account);
    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;

    await Promise.all([refreshBalance(), refreshClaimInfo()]);
    setStatus('Wallet connected on Base.', 'success');

  } catch (err) {
    const msg = err?.code === 4001 ? 'Connection rejected.' : (err.message || 'Connection failed.');
    setStatus(msg, 'error');
    connectBtn.textContent = 'Connect Wallet';
    connectBtn.disabled = false;
  }
}

    provider = new BrowserProvider(ethProvider);
    signer = await provider.getSigner(accounts[0]);
    account = accounts[0];

    tokenContract = new Contract(CONFIG.tokenAddress, TOKEN_ABI, signer);
    claimContract = new Contract(CONFIG.claimAddress, CLAIM_ABI, signer);

    walletEl.hidden = false;
    walletEl.textContent = shortAddress(account);
    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;

    await Promise.all([refreshBalance(), refreshClaimInfo()]);
    setStatus('Wallet connected on Base.', 'success');

  } catch (err) {
    const msg = err?.code === 4001 ? 'Connection rejected.' : (err.message || 'Connection failed.');
    setStatus(msg, 'error');
    connectBtn.textContent = 'Connect Wallet';
    connectBtn.disabled = false;
  }
}

async function submitClaim() {
  if (!claimContract || !account) return;
  claimBtn.disabled = true;
  setStatus('Confirm the transaction in your wallet…');
  try {
    const tx = await claimContract.claim();
    setStatus('Transaction submitted. Waiting for confirmation…');
    await tx.wait();
    setStatus('Successfully claimed 1,000 CSM!', 'success');
    await Promise.all([refreshBalance(), refreshClaimInfo()]);
  } catch (err) {
    setStatus(err.reason || err.message || 'Claim failed.', 'error');
    await refreshClaimInfo();
  }
}

connectBtn.addEventListener('click', () => void connectWallet());
claimBtn.addEventListener('click', () => void submitClaim());

startCountdownLoop();