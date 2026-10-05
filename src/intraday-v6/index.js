import { createWorkspace, changeBias, changeStructure, changeDirection, chooseSetup, setOpportunityStage, markEntered, endOpportunity, markTradeExited, markAllTradesExited, deleteRecord, recordInitialStop, correctInitialStop, recordBofToPb, revertBofToPb } from './model.js';
import { assertV6State } from './validation.js';
import { activeOpportunityForSymbol, activeTradesForSymbol, effectiveDirectionForSymbol, recordLifecycleState } from './queries.js';
import { migrateV5ToV6 } from './migration.js';

// Production facade keeps frozen M1 module scopes and the legacy migration scope separate.
export const intradayV6 = Object.freeze({ createWorkspace, assertV6State, changeBias, changeStructure, changeDirection, chooseSetup, setOpportunityStage, markEntered, endOpportunity, markTradeExited, markAllTradesExited, deleteRecord, recordInitialStop, correctInitialStop, recordBofToPb, revertBofToPb, activeOpportunityForSymbol, activeTradesForSymbol, effectiveDirectionForSymbol, recordLifecycleState, migrateV5ToV6 });
