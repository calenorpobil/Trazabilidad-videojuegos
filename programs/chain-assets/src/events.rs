use anchor_lang::prelude::*;

#[event]
pub struct GameInitialized {
    pub game: Pubkey,
    pub game_id: String,
    pub authority: Pubkey,
}

#[event]
pub struct AuthorityRotated {
    pub game: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct ItemCreated {
    pub game: Pubkey,
    pub mint: Pubkey,
    pub item_seed: [u8; 32],
}

#[event]
pub struct ItemGranted {
    pub game: Pubkey,
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ItemTransferred {
    pub game: Pubkey,
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}
