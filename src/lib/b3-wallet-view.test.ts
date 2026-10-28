import { describe,it,expect } from "vitest";
import { walletSteps,walletSummary,walletExposure,type RobotWallet } from "./b3-wallet-view";
const wallet = { symbol:"WIN",saldo_atual_brl:300,margin:155,max_contracts:1,contratos_atuais:1,estado:"ativa" } as RobotWallet;
describe("carteira somente leitura",()=> {
 it("degrau WIN 2 contratos custa 403, faltam 103",()=> { expect(walletSteps(wallet)).toMatchObject({ allowed:1,next:2,missing:103,capped:false }); });
 it("carteira cobre mais mas teto permanece 1",()=> { expect(walletSteps({...wallet,saldo_atual_brl:604.5})).toMatchObject({allowed:3,capped:true}); });
 it("abaixo de 201,50 cobre zero e insuficiente não é desligado",()=> { expect(walletSteps({...wallet,saldo_atual_brl:200})?.allowed).toBe(0); expect(walletSummary([{...wallet,estado:"carteira_insuficiente"},wallet]).insufficient).toBe(1); });
 it("bruta cobra ambas as pontas, líquida usa diferença",()=> { expect(walletExposure([{symbol:"WINZ26",open:{side:"buy",quantity:3}},{symbol:"WINZ26",open:{side:"sell",quantity:2}}],new Map([["WIN",155]]))).toEqual({gross:775,net:155,grossContracts:5,netContracts:1}); });
 it("não compensa lados de ativos diferentes",()=> { expect(walletExposure([{symbol:"WINZ26",open:{side:"buy",quantity:1}},{symbol:"BITV26",open:{side:"sell",quantity:1}}],new Map([["WIN",155],["BIT",45]]))?.net).toBe(200); });
});