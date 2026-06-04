// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CSM Daily Claim
/// @notice Distributes 1000 CSM per claim, up to 3 claims per 24h period, then a 24h cooldown before the next set.
/// @dev Fund via token owner approval: owner must call token.approve(address(this), amount).
contract CSMClaim is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public fundingSource;

    uint256 public constant CLAIM_AMOUNT = 1000 ether;
    uint256 public constant MAX_CLAIMS_PER_SET = 3;
    uint256 public constant COOLDOWN = 24 hours;

    struct UserClaim {
        uint256 periodStart;
        uint8 claimCount;
    }

    mapping(address => UserClaim) private _claims;

    event Claimed(address indexed user, uint256 amount, uint8 claimNumberInSet);
    event FundingSourceUpdated(address indexed previous, address indexed next);

    error CooldownActive(uint256 availableAt);
    error InsufficientAllowance();

    constructor(IERC20 token_, address fundingSource_) Ownable(msg.sender) {
        token = token_;
        fundingSource = fundingSource_;
    }

    /// @notice Update the address whose balance is used for claims (must approve this contract).
    function setFundingSource(address fundingSource_) external onlyOwner {
        address previous = fundingSource;
        fundingSource = fundingSource_;
        emit FundingSourceUpdated(previous, fundingSource_);
    }

    /// @notice Claim 1000 CSM if eligible.
    function claim() external nonReentrant {
        UserClaim storage user = _claims[msg.sender];
        _syncPeriod(user);

        if (user.claimCount == 0) {
            user.periodStart = block.timestamp;
        }

        user.claimCount += 1;

        if (token.allowance(fundingSource, address(this)) < CLAIM_AMOUNT) {
            revert InsufficientAllowance();
        }

        token.safeTransferFrom(fundingSource, msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT, user.claimCount);
    }

    function getClaimInfo(address account)
        external
        view
        returns (uint8 claimsUsed, uint8 claimsRemaining, uint256 nextResetTimestamp, bool canClaimNow)
    {
        UserClaim memory simulated = _claims[account];
        _syncPeriodView(simulated);

        claimsUsed = simulated.claimCount;
        if (claimsUsed >= MAX_CLAIMS_PER_SET) {
            claimsRemaining = 0;
            nextResetTimestamp = simulated.periodStart + COOLDOWN;
            canClaimNow = block.timestamp >= nextResetTimestamp;
        } else {
            claimsRemaining = uint8(MAX_CLAIMS_PER_SET - claimsUsed);
            nextResetTimestamp =
                claimsUsed == 0 ? 0 : simulated.periodStart + COOLDOWN;
            canClaimNow = claimsRemaining > 0;
        }
    }

    function _syncPeriod(UserClaim storage user) internal {
        if (user.claimCount == 0) {
            return;
        }
        if (block.timestamp >= user.periodStart + COOLDOWN) {
            user.claimCount = 0;
            user.periodStart = 0;
            return;
        }
        if (user.claimCount >= MAX_CLAIMS_PER_SET) {
            revert CooldownActive(user.periodStart + COOLDOWN);
        }
    }

    function _syncPeriodView(UserClaim memory user) internal view {
        if (user.claimCount == 0) {
            return;
        }
        if (block.timestamp >= user.periodStart + COOLDOWN) {
            user.claimCount = 0;
            user.periodStart = 0;
        }
    }
}
