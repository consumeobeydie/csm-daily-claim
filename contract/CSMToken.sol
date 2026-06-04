// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CSM Token - Consumeobeydie Daily Claim Token
/// @notice ERC-20 with fixed supply minted entirely to the deployer (contract owner).
contract CSMToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 100_000_000_000 ether; // 100 billion CSM (18 decimals)

    constructor() ERC20("Consumeobeydie Daily Claim Token", "CSM") Ownable(msg.sender) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
