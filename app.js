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

let provider, signer, account, tokenContract, claimContract, claimInfo, countdownTimer;

try { sdk.actions.ready(); } catch {}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = `status${type ? ' ' + type : ''}`;
}

function shortAddress(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function formatBalance(raw, dec) {
  return Number(formatUnits(raw, dec)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatCountdown(sec) {
  if (sec <= 0) return 'Ready';
  return [Math.floor(sec/3600), Math.floor((sec%3600)/60), Math.floor(sec%60)]
    .map(n => String(n).padStart(2,'0')).join(':');
}

function updateClaimsUI() {
  if (!claimInfo) { claimsEl.textContent = '0/3'; countdownEl.textContent = '—'; claimBtn.disabled = true; return; }
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

async function refreshBalance() {
  if (!tokenContract || !account) { balanceEl.textContent = '—'; return; }
  try {
    const [raw, dec] = await Promise.all([tokenContract.balanceOf(account), tokenContract.decimals()]);
    balanceEl.textContent = formatBalance(raw, dec);
  } catch { balanceEl.textContent = '—'; }
}

async function refreshClaimInfo() {
  if (!claimContract || !account) { claimInfo = null; updateClaimsUI(); return; }
  try {
    const r = await claimContract.getClaimInfo(account);
    claimInfo = { claimsUsed: r[0], claimsRemaining: r[1], nextResetTimestamp: r[2], canClaimNow: r[3] };
  } catch { claimInfo = null; }
  updateClaimsUI();
}

async function connectWallet() {
  connectBtn.textContent = 'Connecting…';
  connectBtn.disabled = true;
  setStatus('Connecting…');

  try {
    let ethProvider = null;

    // 1. Try Farcaster SDK provider
    try {
      const fp = await Promise.race([
        sdk.wallet.getEthereumProvider(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
      ]);
      if (fp && typeof fp.request === 'function') ethProvider = fp;
    } catch {}

    // 2. Fallback to window.ethereum
    if (!ethProvider) {
      if (window.ethereum) {
        ethProvider = window.ethereum;
      } else {
        throw new Error('No wallet found. Install MetaMask or open in Base App.');
      }
    }

    // 3. Get accounts
    let accounts = [];
    try { accounts = await ethProvider.request({ method: 'eth_accounts' }); } catch {}
    if (!accounts || accounts.length === 0) {
      accounts = await ethProvider.request({ method: 'eth_requestAccounts' });
    }
    if (!accounts || accounts.length === 0) throw new Error('No accounts returned.');

    // 4. Switch to Base if needed
    try {
      const chainHex = await ethProvider.request({ method: 'eth_chainId' });
      if (parseInt(chainHex, 16) !== CONFIG.chainId) {
        try {
          await ethProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CONFIG.chainId.toString(16) }] });
        } catch (e) {
          if (e.code === 4902) {
            await ethProvider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x' + CONFIG.chainId.toString(16), chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [CONFIG.rpcUrl], blockExplorerUrls: ['https://basescan.org'] }] });
          }
        }
      }
    } catch {}

    // 5. Setup provider and contracts
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
    setStatus(err?.code === 4001 ? 'Connection rejected.' : (err.message || 'Connection failed.'), 'error');
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

connectBtn.addEventListener('click', connectWallet);
claimBtn.addEventListener('click', submitClaim);

if (countdownTimer) clearInterval(countdownTimer);
countdownTimer = setInterval(updateClaimsUI, 1000);
updateClaimsUI();