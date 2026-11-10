import { expect, it } from "vitest";
import { brokerExit, realApuracao } from "./b3-real-apuracao";
import { reconcileB3LiveOrders } from "./b3-real-reconcile.server";

it("the four gains and seven broker losses total -197", () => {
  expect(realApuracao([30,55,59,58,-56,-66,-36,-105,-45,-38,-53].map(net_result_brl => ({net_result_brl})))).toEqual({realized_brl:-197, unappraised_count:0, result_unknown:false});
});
it("seven missing losses cannot be a trusted +202", () => {
  expect(realApuracao([30,55,59,58,null,null,null,null,null,null,null].map(net_result_brl => ({net_result_brl})))).toEqual({realized_brl:202, unappraised_count:7, result_unknown:true});
});
const order = {broker_ticket_entry:"123", quantity:1, entry_time:"2026-11-11T12:00:00Z"};
const deal = {ticket_posicao:"123", volume:1, preco:130000, resultado_brl:-56, fechado_em:"2026-11-11T12:05:00Z"};
it("uses exact broker position and the reported loss", () => { expect(brokerExit(order,[deal])).toEqual(deal); });
it("never converts a null result into zero", () => { expect(brokerExit(order,[{...deal, resultado_brl:null}])).toBeNull(); });
it("does not match a reused magic instead of the position ticket", () => { expect(brokerExit(order,[{...deal,ticket_posicao:"999",magic:2002}])).toBeNull(); });
it("does not select one of several partial exits", () => { expect(brokerExit(order,[deal,deal])).toBeNull(); });
it("rejects missing exit price", () => { expect(brokerExit(order,[{...deal,preco:null}])).toBeNull(); });
it("rejects a single partial exit", () => { expect(brokerExit({...order,quantity:2},[deal])).toBeNull(); });
it("rejects exits preceding the order", () => { expect(brokerExit(order,[{...deal,fechado_em:"2026-11-10T12:00:00Z"}])).toBeNull(); });

it("reconciles a reported loss without touching historical rows or inventing fees", async () => {
  const entry = new Date(Date.now() - 180000).toISOString();
  const exit = new Date(Date.now() - 60000).toISOString();
  const reportedDeal = {...deal, fechado_em:exit};
  const writes: any[] = [];
  const filters: any[] = [];
  const db = { from(table: string) {
    let update: any;
    const query: any = {
      select: () => query, in: () => query,
      gte: (field: string, value: string) => { filters.push([field,value]); return query; },
      eq: () => query, update: (data: any) => { update=data; return query; },
      insert: async () => ({error:null}),
      then: (resolve: any) => {
        if (update) { writes.push(update); return Promise.resolve({error:null}).then(resolve); }
        return Promise.resolve({data: table === "b3_live_orders"
          ? [{...order,entry_time:entry,id:"new",user_id:"owner",status:"open",symbol:"WINZ26",magic_number:2002}]
          : [{user_id:"owner", reportado_em:new Date().toISOString(),posicoes:[],fechamentos:[reportedDeal]}],error:null}).then(resolve);
      },
    }; return query;
  }};
  const r = await reconcileB3LiveOrders(db);
  expect(r.conciliadas).toBe(1);
  expect(filters).toContainEqual(["entry_time","2026-11-11T03:00:00.000Z"]);
  expect(writes).toEqual([{exit_price:130000,exit_time:exit,net_result_brl:-56,status:"closed",fechamento_corretora:{...reportedDeal,quem_fechou:"corretora"}}]);
});