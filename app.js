import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.2.3';
import { BrowserProvider, Contract, formatUnits } from 'https://esm.sh/ethers@6.13.4';

// Replace with deployed contract addresses on Base mainnet
const CONFIG = {
  chainId: 8453,
  chainName: 'Base',
  rpcUrl: 'https://mainnet.base.org',
  tokenAddress: '0x9ECF496059E601ca541712319d34fa053602289D',
  claimAddress: '0x8aE6bF520DdF004b8b38F2314d4D7de9afD46110',
};

const BASE_CHAIN = {
  chainId: `0x${CONFIG.chainId.toString(16)}`,
  chainName: CONFIG.chainName,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [CONFIG.rpcUrl],
  blockExplorerUrls: ['https://basescan.org'],
};

const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const CLAIM_ABI = [
  'function claim()',
  'function getClaimInfo(address) view returns (uint8 claimsUsed, uint8 claimsRemaining, uint256 nextResetTimestamp, bool canClaimNow)',
  'function CLAIM_AMOUNT() view returns (uint256)',
  'function MAX_CLAIMS_PER_SET() view returns (uint256)',
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
let countdownTimer = null;
let claimInfo = null;
let sdkReadyPromise = null;
let inMiniApp = false;

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` ${type}` : ''}`;
}

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatBalance(raw, decimals) {
  const formatted = formatUnits(raw, decimals);
  const num = Number(formatted);
  if (num >= 1_000_000) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
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
  const max = 3;
  claimsEl.textContent = `${used}/${max}`;

  const now = Math.floor(Date.now() / 1000);
  const resetAt = Number(claimInfo.nextResetTimestamp);

  if (used >= max && resetAt > now) {
    const remaining = resetAt - now;
    countdownEl.textContent = formatCountdown(remaining);
    claimBtn.disabled = true;
  } else if (claimInfo.canClaimNow && account) {
    countdownEl.textContent = 'Ready';
    claimBtn.disabled = false;
  } else {
    countdownEl.textContent = used > 0 && resetAt > now
      ? formatCountdown(resetAt - now)
      : 'Ready';
    claimBtn.disabled = !claimInfo.canClaimNow || !account;
  }
}

function startCountdownLoop() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    updateClaimsUI();
  }, 1000);
}

function hasProviderRequest(ethProvider) {
  return ethProvider != null && typeof ethProvider.request === 'function';
}

function getInjectedProvider() {
  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.providers?.length) {
    return (
      eth.providers.find((p) => p.isMetaMask && hasProviderRequest(p)) ||
      eth.providers.find((p) => (p.isCoinbaseWallet || p.isCoinbaseBrowser) && hasProviderRequest(p)) ||
      eth.providers.find(hasProviderRequest)
    );
  }
  return hasProviderRequest(eth) ? eth : null;
}

async function ensureSdkReady() {
  if (!sdkReadyPromise) {
    sdkReadyPromise = (async () => {
      await sdk.actions.ready();
      try {
        inMiniApp = await sdk.isInMiniApp({ timeoutMs: 3000 });
      } catch {
        inMiniApp = false;
      }
      if (!inMiniApp) {
        try {
          const probe = await sdk.wallet.getEthereumProvider();
          if (hasProviderRequest(probe)) inMiniApp = true;
        } catch {
          // Not running in a Mini App host
        }
      }
    })();
  }
  await sdkReadyPromise;
}

async function getMiniAppProvider() {
  const fcProvider = await sdk.wallet.getEthereumProvider();
  if (!hasProviderRequest(fcProvider)) {
    throw new Error('Embedded wallet is not available in this client.');
  }
  return fcProvider;
}

async function ensureBaseNetwork(ethProvider) {
  if (!hasProviderRequest(ethProvider)) {
    throw new Error('Wallet provider is not available.');
  }

  let chainIdHex;
  try {
    chainIdHex = await ethProvider.request({ method: 'eth_chainId' });
  } catch (e) {
    throw new Error(parseWalletError(e));
  }
  if (!chainIdHex) return;

  const current = parseInt(chainIdHex, 16);
  if (current === CONFIG.chainId) return;

  try {
    await ethProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_CHAIN.chainId }],
    });
  } catch (switchError) {
    if (switchError?.code === 4902) {
      try {
        await ethProvider.request({
          method: 'wallet_addEthereumChain',
          params: [BASE_CHAIN],
        });
      } catch {
        // Some hosts return empty RPC responses for add/switch
      }
    }
    const recheck = await ethProvider.request({ method: 'eth_chainId' }).catch(() => null);
    if (parseInt(recheck, 16) === CONFIG.chainId) return;
    throw switchError;
  }
}

async function getEthereumProvider() {
  await ensureSdkReady();

  if (inMiniApp) {
    return getMiniAppProvider();
  }

  const injected = getInjectedProvider();
  if (injected) return injected;

  throw new Error('No wallet found. Install MetaMask or Coinbase Wallet.');
}

async function initContracts() {
  tokenContract = new Contract(CONFIG.tokenAddress, TOKEN_ABI, signer);
  claimContract = new Contract(CONFIG.claimAddress, CLAIM_ABI, signer);
}

async function refreshBalance() {
  if (!tokenContract || !account) {
    balanceEl.textContent = '—';
    return;
  }
  try {
    const [raw, decimals] = await Promise.all([
      tokenContract.balanceOf(account),
      tokenContract.decimals(),
    ]);
    balanceEl.textContent = formatBalance(raw, decimals);
  } catch {
    balanceEl.textContent = '—';
  }
}

async function refreshClaimInfo() {
  if (!claimContract || !account) {
    claimInfo = null;
    updateClaimsUI();
    return;
  }
  try {
    const result = await claimContract.getClaimInfo(account);
    claimInfo = {
      claimsUsed: result.claimsUsed ?? result[0],
      claimsRemaining: result.claimsRemaining ?? result[1],
      nextResetTimestamp: result.nextResetTimestamp ?? result[2],
      canClaimNow: result.canClaimNow ?? result[3],
    };
  } catch {
    claimInfo = null;
  }
  updateClaimsUI();
}

async function connectWallet({ silent = false } = {}) {
  if (!silent) setStatus('Connecting…');
  connectBtn.disabled = true;

  try {
    await ensureSdkReady();
    const ethProvider = await getEthereumProvider();

    // Base App / Warpcast embedded wallet is already on Base; chain switch breaks host RPC
    if (!inMiniApp) {
      await ensureBaseNetwork(ethProvider);
    }

    const accounts = await ethProvider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) {
      throw new Error('No accounts returned from wallet.');
    }

    provider = new BrowserProvider(ethProvider);
    signer = await provider.getSigner();
    account = await signer.getAddress();

    await initContracts();
    await Promise.all([refreshBalance(), refreshClaimInfo()]);

    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;
    walletEl.hidden = false;
    walletEl.textContent = shortAddress(account);
    setStatus('Wallet connected on Base.', 'success');
  } catch (err) {
    if (!silent) setStatus(parseWalletError(err), 'error');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Wallet';
  }
}

function parseWalletError(err) {
  if (err == null) return 'Connection failed.';
  if (typeof err === 'string') return err;
  const code = err.code ?? err.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') {
    return 'Connection rejected in wallet.';
  }
  const message =
    err.shortMessage ||
    err.message ||
    err.reason ||
    (typeof err.error === 'string' ? err.error : err.error?.message);
  if (message?.includes('No wallet')) return message;
  if (message?.includes("reading 'error'")) {
    return 'Wallet connection failed. Try again or use MetaMask / Coinbase Wallet.';
  }
  return message || 'Connection failed.';
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
    const msg = parseWalletError(err);
    if (err?.data || err?.reason) {
      setStatus(err.reason || msg, 'error');
    } else {
      setStatus(msg, 'error');
    }
    await refreshClaimInfo();
  }
}

function contractsConfigured() {
  const zero = '0x0000000000000000000000000000000000000000';
  return CONFIG.tokenAddress !== zero && CONFIG.claimAddress !== zero;
}

async function init() {
  await ensureSdkReady();
  startCountdownLoop();

  if (!contractsConfigured()) {
    setStatus('Set contract addresses in app.js after deploying to Base.', 'error');
  }

  connectBtn.addEventListener('click', connectWallet);
  claimBtn.addEventListener('click', submitClaim);

  try {
    if (inMiniApp) {
      await connectWallet({ silent: true });
    } else {
      const ethProvider = await getEthereumProvider();
      const accounts = await ethProvider.request({ method: 'eth_accounts' });
      if (accounts?.length) await connectWallet();
    }
  } catch {
    // User will connect manually
  }
}

init();
