export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_evolution_log: {
        Row: {
          agent_id: string
          created_at: string
          decision_id: string | null
          id: string
          outcome: string | null
          pnl: number | null
          reputation_delta: number | null
          vote: string | null
          weight_after: number | null
          weight_before: number | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          decision_id?: string | null
          id?: string
          outcome?: string | null
          pnl?: number | null
          reputation_delta?: number | null
          vote?: string | null
          weight_after?: number | null
          weight_before?: number | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          decision_id?: string | null
          id?: string
          outcome?: string | null
          pnl?: number | null
          reputation_delta?: number | null
          vote?: string | null
          weight_after?: number | null
          weight_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_evolution_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_evolution_log_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_performance_history: {
        Row: {
          agent_id: string | null
          agent_name: string
          bad_votes: number
          created_at: string
          drawdown_caused: number
          good_votes: number
          hit_rate: number
          id: string
          profit_simulated: number
          run_id: string
          score: number
        }
        Insert: {
          agent_id?: string | null
          agent_name: string
          bad_votes?: number
          created_at?: string
          drawdown_caused?: number
          good_votes?: number
          hit_rate?: number
          id?: string
          profit_simulated?: number
          run_id: string
          score?: number
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          bad_votes?: number
          created_at?: string
          drawdown_caused?: number
          good_votes?: number
          hit_rate?: number
          id?: string
          profit_simulated?: number
          run_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_performance_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_performance_history_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_rankings: {
        Row: {
          accuracy: number | null
          agent_id: string
          computed_at: string
          consistency: number | null
          drawdown_caused: number | null
          id: string
          justification_quality: number | null
          period: string
          profit_contribution: number | null
          score: number
          trades_count: number
          veto_precision: number | null
        }
        Insert: {
          accuracy?: number | null
          agent_id: string
          computed_at?: string
          consistency?: number | null
          drawdown_caused?: number | null
          id?: string
          justification_quality?: number | null
          period: string
          profit_contribution?: number | null
          score?: number
          trades_count?: number
          veto_precision?: number | null
        }
        Update: {
          accuracy?: number | null
          agent_id?: string
          computed_at?: string
          consistency?: number | null
          drawdown_caused?: number | null
          id?: string
          justification_quality?: number | null
          period?: string
          profit_contribution?: number | null
          score?: number
          trades_count?: number
          veto_precision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_rankings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reputation: {
        Row: {
          agent_id: string
          consistency: number
          hits: number
          id: string
          max_drawdown: number
          misses: number
          profit_simulated: number
          risk_reward: number
          score: number
          updated_at: string
          weight_current: number
        }
        Insert: {
          agent_id: string
          consistency?: number
          hits?: number
          id?: string
          max_drawdown?: number
          misses?: number
          profit_simulated?: number
          risk_reward?: number
          score?: number
          updated_at?: string
          weight_current?: number
        }
        Update: {
          agent_id?: string
          consistency?: number
          hits?: number
          id?: string
          max_drawdown?: number
          misses?: number
          profit_simulated?: number
          risk_reward?: number
          score?: number
          updated_at?: string
          weight_current?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_reputation_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_votes: {
        Row: {
          agent_id: string
          confidence: number
          data_used: Json | null
          decision_id: string | null
          has_veto: boolean
          id: string
          justification: string | null
          knowledge_refs: Json | null
          pair: string
          perceived_risk: number | null
          veto_reason: string | null
          vote: string
          voted_at: string
        }
        Insert: {
          agent_id: string
          confidence?: number
          data_used?: Json | null
          decision_id?: string | null
          has_veto?: boolean
          id?: string
          justification?: string | null
          knowledge_refs?: Json | null
          pair: string
          perceived_risk?: number | null
          veto_reason?: string | null
          vote: string
          voted_at?: string
        }
        Update: {
          agent_id?: string
          confidence?: number
          data_used?: Json | null
          decision_id?: string | null
          has_veto?: boolean
          id?: string
          justification?: string | null
          knowledge_refs?: Json | null
          pair?: string
          perceived_risk?: number | null
          veto_reason?: string | null
          vote?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_votes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active: boolean
          created_at: string
          expert_id: string | null
          id: string
          kind: string
          name: string
          profile: string
          rules: string | null
          strategy_description: string | null
          updated_at: string
          veto_power: boolean
          weight: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          expert_id?: string | null
          id?: string
          kind?: string
          name: string
          profile: string
          rules?: string | null
          strategy_description?: string | null
          updated_at?: string
          veto_power?: boolean
          weight?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          expert_id?: string | null
          id?: string
          kind?: string
          name?: string
          profile?: string
          rules?: string | null
          strategy_description?: string | null
          updated_at?: string
          veto_power?: boolean
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "agents_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged: boolean
          created_at: string
          data: Json | null
          id: string
          message: string
          pair: string | null
          severity: string
          type: string
        }
        Insert: {
          acknowledged?: boolean
          created_at?: string
          data?: Json | null
          id?: string
          message: string
          pair?: string | null
          severity?: string
          type: string
        }
        Update: {
          acknowledged?: boolean
          created_at?: string
          data?: Json | null
          id?: string
          message?: string
          pair?: string | null
          severity?: string
          type?: string
        }
        Relationships: []
      }
      approval_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip: string | null
          payload: Json | null
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip?: string | null
          payload?: Json | null
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip?: string | null
          payload?: Json | null
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          kind: string
          message: string | null
          position_id: string | null
          request_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          kind: string
          message?: string | null
          position_id?: string | null
          request_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          kind?: string
          message?: string | null
          position_id?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      audit_reports: {
        Row: {
          classification: string | null
          content: Json
          created_at: string
          id: string
          phase: string
          position_id: string | null
          request_id: string | null
          summary: string | null
        }
        Insert: {
          classification?: string | null
          content?: Json
          created_at?: string
          id?: string
          phase: string
          position_id?: string | null
          request_id?: string | null
          summary?: string | null
        }
        Update: {
          classification?: string | null
          content?: Json
          created_at?: string
          id?: string
          phase?: string
          position_id?: string | null
          request_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_reports_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "real_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_reports_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_trade_audits: {
        Row: {
          automated_trade_id: string | null
          content: string | null
          created_at: string
          decision_chain: Json
          id: string
          phase: string
          summary: string | null
        }
        Insert: {
          automated_trade_id?: string | null
          content?: string | null
          created_at?: string
          decision_chain?: Json
          id?: string
          phase: string
          summary?: string | null
        }
        Update: {
          automated_trade_id?: string | null
          content?: string | null
          created_at?: string
          decision_chain?: Json
          id?: string
          phase?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automated_trade_audits_automated_trade_id_fkey"
            columns: ["automated_trade_id"]
            isOneToOne: false
            referencedRelation: "automated_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_trades: {
        Row: {
          asset_id: string | null
          automation_level: number
          closed_at: string | null
          consensus: number | null
          created_at: string
          entry_price: number
          exit_price: number | null
          exit_reason: string | null
          id: string
          opened_at: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          request_id: string | null
          risk_amount: number | null
          score: number | null
          session_id: string | null
          side: string
          status: string
          stop_loss: number | null
          supervisor_decision: string | null
          take_profit: number | null
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          automation_level?: number
          closed_at?: string | null
          consensus?: number | null
          created_at?: string
          entry_price: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          request_id?: string | null
          risk_amount?: number | null
          score?: number | null
          session_id?: string | null
          side: string
          status?: string
          stop_loss?: number | null
          supervisor_decision?: string | null
          take_profit?: number | null
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          automation_level?: number
          closed_at?: string | null
          consensus?: number | null
          created_at?: string
          entry_price?: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          request_id?: string | null
          risk_amount?: number | null
          score?: number | null
          session_id?: string | null
          side?: string
          status?: string
          stop_loss?: number | null
          supervisor_decision?: string | null
          take_profit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automated_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_trades_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_trades_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_agent_votes: {
        Row: {
          agent_name: string
          confidence: number
          created_at: string
          id: string
          market_data_snapshot: Json | null
          order_id: string | null
          reason: string | null
          user_id: string
          vote: string
        }
        Insert: {
          agent_name: string
          confidence?: number
          created_at?: string
          id?: string
          market_data_snapshot?: Json | null
          order_id?: string | null
          reason?: string | null
          user_id: string
          vote: string
        }
        Update: {
          agent_name?: string
          confidence?: number
          created_at?: string
          id?: string
          market_data_snapshot?: Json | null
          order_id?: string | null
          reason?: string | null
          user_id?: string
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_agent_votes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "b3_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_daily_report: {
        Row: {
          closed_positions: number
          created_at: string
          daily_status: string
          fees: number
          gross_result: number
          id: string
          net_result: number
          open_positions: number
          starting_balance: number
          total_bought: number
          total_sold: number
          trade_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_positions?: number
          created_at?: string
          daily_status?: string
          fees?: number
          gross_result?: number
          id?: string
          net_result?: number
          open_positions?: number
          starting_balance?: number
          total_bought?: number
          total_sold?: number
          trade_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_positions?: number
          created_at?: string
          daily_status?: string
          fees?: number
          gross_result?: number
          id?: string
          net_result?: number
          open_positions?: number
          starting_balance?: number
          total_bought?: number
          total_sold?: number
          trade_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_orders: {
        Row: {
          close_reason: string | null
          contract_code: string
          created_at: string
          entry_price: number
          entry_time: string
          environment: string
          exit_price: number | null
          exit_time: string | null
          fees: number
          gross_result_brl: number | null
          gross_result_points: number | null
          id: string
          net_result_brl: number | null
          quantity: number
          side: string
          status: string
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          close_reason?: string | null
          contract_code: string
          created_at?: string
          entry_price: number
          entry_time?: string
          environment?: string
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          gross_result_brl?: number | null
          gross_result_points?: number | null
          id?: string
          net_result_brl?: number | null
          quantity?: number
          side: string
          status?: string
          symbol?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          close_reason?: string | null
          contract_code?: string
          created_at?: string
          entry_price?: number
          entry_time?: string
          environment?: string
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          gross_result_brl?: number | null
          gross_result_points?: number | null
          id?: string
          net_result_brl?: number | null
          quantity?: number
          side?: string
          status?: string
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_trading_settings: {
        Row: {
          alert_only_enabled: boolean
          api_status: string
          auto_trade_enabled: boolean
          broker_name: string
          capital_allocated: number
          created_at: string
          daily_gain_target: number
          daily_loss_limit: number
          end_time: string
          environment: string
          force_close_time: string
          gain_points: number
          id: string
          max_contracts: number
          start_time: string
          stop_points: number
          strategy_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_only_enabled?: boolean
          api_status?: string
          auto_trade_enabled?: boolean
          broker_name?: string
          capital_allocated?: number
          created_at?: string
          daily_gain_target?: number
          daily_loss_limit?: number
          end_time?: string
          environment?: string
          force_close_time?: string
          gain_points?: number
          id?: string
          max_contracts?: number
          start_time?: string
          stop_points?: number
          strategy_mode?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_only_enabled?: boolean
          api_status?: string
          auto_trade_enabled?: boolean
          broker_name?: string
          capital_allocated?: number
          created_at?: string
          daily_gain_target?: number
          daily_loss_limit?: number
          end_time?: string
          environment?: string
          force_close_time?: string
          gain_points?: number
          id?: string
          max_contracts?: number
          start_time?: string
          stop_points?: number
          strategy_mode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      backtest_agent_votes: {
        Row: {
          agent_id: string | null
          agent_name: string
          candle_time: string
          confidence: number
          created_at: string
          has_veto: boolean
          id: string
          outcome: string | null
          pair: string
          perceived_risk: number
          run_id: string
          timeframe: string
          vote: string
          weight_used: number
        }
        Insert: {
          agent_id?: string | null
          agent_name: string
          candle_time: string
          confidence?: number
          created_at?: string
          has_veto?: boolean
          id?: string
          outcome?: string | null
          pair: string
          perceived_risk?: number
          run_id: string
          timeframe: string
          vote: string
          weight_used?: number
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          candle_time?: string
          confidence?: number
          created_at?: string
          has_veto?: boolean
          id?: string
          outcome?: string | null
          pair?: string
          perceived_risk?: number
          run_id?: string
          timeframe?: string
          vote?: string
          weight_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "backtest_agent_votes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backtest_agent_votes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_metrics: {
        Row: {
          avg_hold_minutes: number
          avg_rr: number
          biggest_loss: number
          biggest_win: number
          breakdown_by_agent: Json | null
          breakdown_by_asset: Json | null
          breakdown_by_decision: Json | null
          breakdown_by_timeframe: Json | null
          created_at: string
          drawdown_curve: Json | null
          equity_curve: Json | null
          final_balance: number
          initial_balance: number
          max_drawdown: number
          max_drawdown_pct: number
          max_loss_streak: number
          max_win_streak: number
          n_losses: number
          n_trades: number
          n_wins: number
          profit_factor: number
          return_pct: number
          run_id: string
          total_pnl: number
          win_rate: number
        }
        Insert: {
          avg_hold_minutes?: number
          avg_rr?: number
          biggest_loss?: number
          biggest_win?: number
          breakdown_by_agent?: Json | null
          breakdown_by_asset?: Json | null
          breakdown_by_decision?: Json | null
          breakdown_by_timeframe?: Json | null
          created_at?: string
          drawdown_curve?: Json | null
          equity_curve?: Json | null
          final_balance?: number
          initial_balance?: number
          max_drawdown?: number
          max_drawdown_pct?: number
          max_loss_streak?: number
          max_win_streak?: number
          n_losses?: number
          n_trades?: number
          n_wins?: number
          profit_factor?: number
          return_pct?: number
          run_id: string
          total_pnl?: number
          win_rate?: number
        }
        Update: {
          avg_hold_minutes?: number
          avg_rr?: number
          biggest_loss?: number
          biggest_win?: number
          breakdown_by_agent?: Json | null
          breakdown_by_asset?: Json | null
          breakdown_by_decision?: Json | null
          breakdown_by_timeframe?: Json | null
          created_at?: string
          drawdown_curve?: Json | null
          equity_curve?: Json | null
          final_balance?: number
          initial_balance?: number
          max_drawdown?: number
          max_drawdown_pct?: number
          max_loss_streak?: number
          max_win_streak?: number
          n_losses?: number
          n_trades?: number
          n_wins?: number
          profit_factor?: number
          return_pct?: number
          run_id?: string
          total_pnl?: number
          win_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "backtest_metrics_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_reports: {
        Row: {
          best_trades: Json | null
          created_at: string
          highlights: Json | null
          pdf_path: string | null
          recommendation: string | null
          run_id: string
          summary: string | null
          warnings: Json | null
          worst_trades: Json | null
        }
        Insert: {
          best_trades?: Json | null
          created_at?: string
          highlights?: Json | null
          pdf_path?: string | null
          recommendation?: string | null
          run_id: string
          summary?: string | null
          warnings?: Json | null
          worst_trades?: Json | null
        }
        Update: {
          best_trades?: Json | null
          created_at?: string
          highlights?: Json | null
          pdf_path?: string | null
          recommendation?: string | null
          run_id?: string
          summary?: string | null
          warnings?: Json | null
          worst_trades?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_reports_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_runs: {
        Row: {
          created_at: string
          error_msg: string | null
          finished_at: string | null
          id: string
          mode: string
          name: string
          processed_candles: number
          started_at: string | null
          status: string
          summary: Json | null
          total_candles: number
        }
        Insert: {
          created_at?: string
          error_msg?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          name: string
          processed_candles?: number
          started_at?: string | null
          status?: string
          summary?: Json | null
          total_candles?: number
        }
        Update: {
          created_at?: string
          error_msg?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          name?: string
          processed_candles?: number
          started_at?: string | null
          status?: string
          summary?: Json | null
          total_candles?: number
        }
        Relationships: []
      }
      backtest_settings: {
        Row: {
          agent_ids: Json | null
          assets: Json
          consensus_rule: Json
          created_at: string
          drawdown_limit_pct: number
          fee_pct: number
          initial_balance: number
          loss_streak_limit: number
          max_trade_value: number
          period_end: string
          period_start: string
          reinvest: boolean
          run_id: string
          slippage_pct: number
          stop_loss_pct: number
          take_profit_pct: number
          timeframes: Json
        }
        Insert: {
          agent_ids?: Json | null
          assets: Json
          consensus_rule?: Json
          created_at?: string
          drawdown_limit_pct?: number
          fee_pct?: number
          initial_balance?: number
          loss_streak_limit?: number
          max_trade_value?: number
          period_end: string
          period_start: string
          reinvest?: boolean
          run_id: string
          slippage_pct?: number
          stop_loss_pct?: number
          take_profit_pct?: number
          timeframes: Json
        }
        Update: {
          agent_ids?: Json | null
          assets?: Json
          consensus_rule?: Json
          created_at?: string
          drawdown_limit_pct?: number
          fee_pct?: number
          initial_balance?: number
          loss_streak_limit?: number
          max_trade_value?: number
          period_end?: string
          period_start?: string
          reinvest?: boolean
          run_id?: string
          slippage_pct?: number
          stop_loss_pct?: number
          take_profit_pct?: number
          timeframes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "backtest_settings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_trades: {
        Row: {
          asset_id: string | null
          created_at: string
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_reason: string | null
          exit_time: string | null
          fee_paid: number
          hold_minutes: number | null
          id: string
          pair: string
          pnl: number | null
          pnl_pct: number | null
          quantity: number
          run_id: string
          side: string
          slippage_applied: number
          timeframe: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          entry_price: number
          entry_time: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          fee_paid?: number
          hold_minutes?: number | null
          id?: string
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          quantity: number
          run_id: string
          side: string
          slippage_applied?: number
          timeframe: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          fee_paid?: number
          hold_minutes?: number | null
          id?: string
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          quantity?: number
          run_id?: string
          side?: string
          slippage_applied?: number
          timeframe?: string
        }
        Relationships: [
          {
            foreignKeyName: "backtest_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backtest_trades_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      binance_connection_status: {
        Row: {
          account_type: string | null
          connected: boolean
          id: number
          last_check: string | null
          last_error: string | null
          permissions: string[] | null
        }
        Insert: {
          account_type?: string | null
          connected?: boolean
          id?: number
          last_check?: string | null
          last_error?: string | null
          permissions?: string[] | null
        }
        Update: {
          account_type?: string | null
          connected?: boolean
          id?: number
          last_check?: string | null
          last_error?: string | null
          permissions?: string[] | null
        }
        Relationships: []
      }
      candles: {
        Row: {
          close: number
          close_time: string
          created_at: string
          high: number
          id: string
          low: number
          open: number
          open_time: string
          pair: string
          timeframe: string
          volume: number
        }
        Insert: {
          close: number
          close_time: string
          created_at?: string
          high: number
          id?: string
          low: number
          open: number
          open_time: string
          pair: string
          timeframe: string
          volume: number
        }
        Update: {
          close?: number
          close_time?: string
          created_at?: string
          high?: number
          id?: string
          low?: number
          open?: number
          open_time?: string
          pair?: string
          timeframe?: string
          volume?: number
        }
        Relationships: []
      }
      capital_management_history: {
        Row: {
          balance: number | null
          confidence: number | null
          created_at: string
          current_drawdown: number | null
          final_size: number | null
          id: string
          reason: string | null
          recent_performance: number | null
          suggested_size: number | null
          volatility: number | null
        }
        Insert: {
          balance?: number | null
          confidence?: number | null
          created_at?: string
          current_drawdown?: number | null
          final_size?: number | null
          id?: string
          reason?: string | null
          recent_performance?: number | null
          suggested_size?: number | null
          volatility?: number | null
        }
        Update: {
          balance?: number | null
          confidence?: number | null
          created_at?: string
          current_drawdown?: number | null
          final_size?: number | null
          id?: string
          reason?: string | null
          recent_performance?: number | null
          suggested_size?: number | null
          volatility?: number | null
        }
        Relationships: []
      }
      circuit_breaker_events: {
        Row: {
          closed_at: string | null
          id: string
          message: string | null
          opened_at: string
          session_id: string | null
          trigger: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          message?: string | null
          opened_at?: string
          session_id?: string | null
          trigger: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          message?: string | null
          opened_at?: string
          session_id?: string | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_breaker_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      committee_debates: {
        Row: {
          created_at: string
          decision_id: string
          id: string
          summary: string | null
          transcript: Json | null
        }
        Insert: {
          created_at?: string
          decision_id: string
          id?: string
          summary?: string | null
          transcript?: Json | null
        }
        Update: {
          created_at?: string
          decision_id?: string
          id?: string
          summary?: string | null
          transcript?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "committee_debates_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      committee_decisions: {
        Row: {
          asset_id: string | null
          avg_confidence: number
          classification: string
          consolidated_justification: string | null
          context: Json | null
          created_at: string
          data_quality: number
          euphoria_vetoed: boolean
          final_decision: string
          id: string
          pair: string
          risk_approved: boolean
          score: number
          session_id: string | null
          timeframe: string
          votes_buy: number
          votes_hold: number
          votes_sell: number
          votes_wait: number
        }
        Insert: {
          asset_id?: string | null
          avg_confidence?: number
          classification: string
          consolidated_justification?: string | null
          context?: Json | null
          created_at?: string
          data_quality?: number
          euphoria_vetoed?: boolean
          final_decision: string
          id?: string
          pair: string
          risk_approved?: boolean
          score?: number
          session_id?: string | null
          timeframe: string
          votes_buy?: number
          votes_hold?: number
          votes_sell?: number
          votes_wait?: number
        }
        Update: {
          asset_id?: string | null
          avg_confidence?: number
          classification?: string
          consolidated_justification?: string | null
          context?: Json | null
          created_at?: string
          data_quality?: number
          euphoria_vetoed?: boolean
          final_decision?: string
          id?: string
          pair?: string
          risk_approved?: boolean
          score?: number
          session_id?: string | null
          timeframe?: string
          votes_buy?: number
          votes_hold?: number
          votes_sell?: number
          votes_wait?: number
        }
        Relationships: [
          {
            foreignKeyName: "committee_decisions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committee_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      committee_settings: {
        Row: {
          default_stop_pct: number
          default_target_pct: number
          id: number
          max_position_value: number
          min_confidence: number
          min_favor_votes: number
          min_score: number
          timeframes: string[]
          updated_at: string
        }
        Insert: {
          default_stop_pct?: number
          default_target_pct?: number
          id?: number
          max_position_value?: number
          min_confidence?: number
          min_favor_votes?: number
          min_score?: number
          timeframes?: string[]
          updated_at?: string
        }
        Update: {
          default_stop_pct?: number
          default_target_pct?: number
          id?: number
          max_position_value?: number
          min_confidence?: number
          min_favor_votes?: number
          min_score?: number
          timeframes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      daily_reports: {
        Row: {
          alerts: Json
          content: string | null
          created_at: string
          drawdown: number | null
          id: string
          losses: number
          net_pnl: number | null
          recommendations: string | null
          report_date: string
          total_trades: number
          wins: number
        }
        Insert: {
          alerts?: Json
          content?: string | null
          created_at?: string
          drawdown?: number | null
          id?: string
          losses?: number
          net_pnl?: number | null
          recommendations?: string | null
          report_date: string
          total_trades?: number
          wins?: number
        }
        Update: {
          alerts?: Json
          content?: string | null
          created_at?: string
          drawdown?: number | null
          id?: string
          losses?: number
          net_pnl?: number | null
          recommendations?: string | null
          report_date?: string
          total_trades?: number
          wins?: number
        }
        Relationships: []
      }
      dynamic_agent_weights: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          new_weight: number | null
          performance_window: number | null
          previous_weight: number | null
          reason: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          new_weight?: number | null
          performance_window?: number | null
          previous_weight?: number | null
          reason?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          new_weight?: number | null
          performance_window?: number | null
          previous_weight?: number | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_agent_weights_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_categories: {
        Row: {
          description: string | null
          id: string
          label: string
          slug: string
        }
        Insert: {
          description?: string | null
          id?: string
          label: string
          slug: string
        }
        Update: {
          description?: string | null
          id?: string
          label?: string
          slug?: string
        }
        Relationships: []
      }
      expert_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          expert_id: string
          id: string
          metadata: Json | null
          source_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          expert_id: string
          id?: string
          metadata?: Json | null
          source_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          expert_id?: string
          id?: string
          metadata?: Json | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_chunks_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "expert_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_sources: {
        Row: {
          chunk_count: number | null
          created_at: string
          error_msg: string | null
          expert_id: string
          id: string
          kind: string
          raw_text: string | null
          status: string
          storage_path: string | null
          title: string | null
          tokens: number | null
          updated_at: string
          url: string | null
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string
          error_msg?: string | null
          expert_id: string
          id?: string
          kind: string
          raw_text?: string | null
          status?: string
          storage_path?: string | null
          title?: string | null
          tokens?: number | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          chunk_count?: number | null
          created_at?: string
          error_msg?: string | null
          expert_id?: string
          id?: string
          kind?: string
          raw_text?: string | null
          status?: string
          storage_path?: string | null
          title?: string | null
          tokens?: number | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_sources_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_strategy: {
        Row: {
          buy_criteria: string | null
          catchphrases: Json | null
          confirmation_criteria: string | null
          exclusion_criteria: string | null
          expert_id: string
          generated_at: string
          id: string
          philosophy: string | null
          risk_criteria: string | null
          sell_criteria: string | null
          updated_at: string
        }
        Insert: {
          buy_criteria?: string | null
          catchphrases?: Json | null
          confirmation_criteria?: string | null
          exclusion_criteria?: string | null
          expert_id: string
          generated_at?: string
          id?: string
          philosophy?: string | null
          risk_criteria?: string | null
          sell_criteria?: string | null
          updated_at?: string
        }
        Update: {
          buy_criteria?: string | null
          catchphrases?: Json | null
          confirmation_criteria?: string | null
          exclusion_criteria?: string | null
          expert_id?: string
          generated_at?: string
          id?: string
          philosophy?: string | null
          risk_criteria?: string | null
          sell_criteria?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_strategy_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      experts: {
        Row: {
          active: boolean
          agent_id: string | null
          bio: string | null
          category_id: string | null
          created_at: string
          id: string
          main_strategy: string | null
          name: string
          photo_url: string | null
          risk_profile: string
          sources_summary: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          bio?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          main_strategy?: string | null
          name: string
          photo_url?: string | null
          risk_profile?: string
          sources_summary?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          bio?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          main_strategy?: string | null
          name?: string
          photo_url?: string | null
          risk_profile?: string
          sources_summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experts_agent_fk"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expert_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_settings: {
        Row: {
          automation_enabled: boolean
          automation_level: number
          created_at: string
          eligibility_min_days: number
          eligibility_min_profit_factor: number
          eligibility_min_trades: number
          id: string
          kill_switch_activated_at: string | null
          kill_switch_active: boolean
          kill_switch_reason: string | null
          max_consecutive_losses: number
          max_daily_losses: number
          max_drawdown_pct: number
          max_weekly_losses: number
          min_confidence_score: number
          min_consensus_for_auto: number
          min_risk_reward: number
          min_score_for_auto: number
          supervisor_enabled: boolean
          updated_at: string
        }
        Insert: {
          automation_enabled?: boolean
          automation_level?: number
          created_at?: string
          eligibility_min_days?: number
          eligibility_min_profit_factor?: number
          eligibility_min_trades?: number
          id?: string
          kill_switch_activated_at?: string | null
          kill_switch_active?: boolean
          kill_switch_reason?: string | null
          max_consecutive_losses?: number
          max_daily_losses?: number
          max_drawdown_pct?: number
          max_weekly_losses?: number
          min_confidence_score?: number
          min_consensus_for_auto?: number
          min_risk_reward?: number
          min_score_for_auto?: number
          supervisor_enabled?: boolean
          updated_at?: string
        }
        Update: {
          automation_enabled?: boolean
          automation_level?: number
          created_at?: string
          eligibility_min_days?: number
          eligibility_min_profit_factor?: number
          eligibility_min_trades?: number
          id?: string
          kill_switch_activated_at?: string | null
          kill_switch_active?: boolean
          kill_switch_reason?: string | null
          max_consecutive_losses?: number
          max_daily_losses?: number
          max_drawdown_pct?: number
          max_weekly_losses?: number
          min_confidence_score?: number
          min_consensus_for_auto?: number
          min_risk_reward?: number
          min_score_for_auto?: number
          supervisor_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      historical_candles: {
        Row: {
          asset_id: string
          close: number
          created_at: string
          high: number
          low: number
          open: number
          open_time: string
          source: string
          timeframe: string
          volume: number
        }
        Insert: {
          asset_id: string
          close: number
          created_at?: string
          high: number
          low: number
          open: number
          open_time: string
          source?: string
          timeframe: string
          volume?: number
        }
        Update: {
          asset_id?: string
          close?: number
          created_at?: string
          high?: number
          low?: number
          open?: number
          open_time?: string
          source?: string
          timeframe?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_candles_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      indicators: {
        Row: {
          change_24h: number | null
          computed_at: string
          id: string
          ma_long: number | null
          ma_short: number | null
          macd: number | null
          macd_signal: number | null
          pair: string
          rsi: number | null
          timeframe: string
          volume_avg: number | null
        }
        Insert: {
          change_24h?: number | null
          computed_at?: string
          id?: string
          ma_long?: number | null
          ma_short?: number | null
          macd?: number | null
          macd_signal?: number | null
          pair: string
          rsi?: number | null
          timeframe: string
          volume_avg?: number | null
        }
        Update: {
          change_24h?: number | null
          computed_at?: string
          id?: string
          ma_long?: number | null
          ma_short?: number | null
          macd?: number | null
          macd_signal?: number | null
          pair?: string
          rsi?: number | null
          timeframe?: string
          volume_avg?: number | null
        }
        Relationships: []
      }
      intelligence_reports: {
        Row: {
          agent_evaluation: Json
          content: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          recommendations: string | null
          risk_analysis: string | null
          summary: string | null
          technical_analysis: string | null
          title: string
          trade_ref: string | null
        }
        Insert: {
          agent_evaluation?: Json
          content: string
          created_at?: string
          id?: string
          kind: string
          metadata?: Json
          recommendations?: string | null
          risk_analysis?: string | null
          summary?: string | null
          technical_analysis?: string | null
          title: string
          trade_ref?: string | null
        }
        Update: {
          agent_evaluation?: Json
          content?: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          recommendations?: string | null
          risk_analysis?: string | null
          summary?: string | null
          technical_analysis?: string | null
          title?: string
          trade_ref?: string | null
        }
        Relationships: []
      }
      knowledge_library: {
        Row: {
          author: string | null
          classification: Json
          content: string | null
          created_at: string
          embedding: string | null
          id: string
          metadata: Json
          source_type: string
          storage_path: string | null
          title: string
          url: string | null
        }
        Insert: {
          author?: string | null
          classification?: Json
          content?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          source_type: string
          storage_path?: string | null
          title: string
          url?: string | null
        }
        Update: {
          author?: string | null
          classification?: Json
          content?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          source_type?: string
          storage_path?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      learning_recommendations: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          description: string
          evidence: Json
          expected_impact: Json
          id: string
          kind: string
          rationale: string | null
          status: string
          suggested_changes: Json
          title: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description: string
          evidence?: Json
          expected_impact?: Json
          id?: string
          kind: string
          rationale?: string | null
          status?: string
          suggested_changes?: Json
          title: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string
          evidence?: Json
          expected_impact?: Json
          id?: string
          kind?: string
          rationale?: string | null
          status?: string
          suggested_changes?: Json
          title?: string
        }
        Relationships: []
      }
      live_simulated_positions: {
        Row: {
          asset_id: string | null
          created_at: string
          decision_id: string | null
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_reason: string | null
          exit_time: string | null
          id: string
          last_price: number | null
          pair: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          session_id: string | null
          side: string
          status: string
          stop_loss: number
          take_profit: number
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          decision_id?: string | null
          entry_price: number
          entry_time?: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          id?: string
          last_price?: number | null
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          session_id?: string | null
          side: string
          status?: string
          stop_loss: number
          take_profit: number
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          decision_id?: string | null
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          id?: string
          last_price?: number | null
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          session_id?: string | null
          side?: string
          status?: string
          stop_loss?: number
          take_profit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_simulated_positions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_simulated_positions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_simulated_positions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_trade_metrics: {
        Row: {
          day: string
          drawdown: number | null
          id: string
          n_trades: number | null
          n_wins: number | null
          pnl: number | null
          profit_factor: number | null
          return_pct: number | null
          session_id: string | null
          sharpe: number | null
          win_rate: number | null
        }
        Insert: {
          day: string
          drawdown?: number | null
          id?: string
          n_trades?: number | null
          n_wins?: number | null
          pnl?: number | null
          profit_factor?: number | null
          return_pct?: number | null
          session_id?: string | null
          sharpe?: number | null
          win_rate?: number | null
        }
        Update: {
          day?: string
          drawdown?: number | null
          id?: string
          n_trades?: number | null
          n_wins?: number | null
          pnl?: number | null
          profit_factor?: number | null
          return_pct?: number | null
          session_id?: string | null
          sharpe?: number | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_trade_metrics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      market_regimes: {
        Row: {
          asset_id: string | null
          confidence: number
          detected_at: string
          id: string
          metadata: Json
          regime: string
          trend_strength: number | null
          volatility: number | null
        }
        Insert: {
          asset_id?: string | null
          confidence?: number
          detected_at?: string
          id?: string
          metadata?: Json
          regime: string
          trend_strength?: number | null
          volatility?: number | null
        }
        Update: {
          asset_id?: string | null
          confidence?: number
          detected_at?: string
          id?: string
          metadata?: Json
          regime?: string
          trend_strength?: number | null
          volatility?: number | null
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          captured_at: string
          change_percent_24h: number | null
          high_24h: number | null
          id: string
          low_24h: number | null
          pair: string
          price: number
          volume_24h: number | null
        }
        Insert: {
          captured_at?: string
          change_percent_24h?: number | null
          high_24h?: number | null
          id?: string
          low_24h?: number | null
          pair: string
          price: number
          volume_24h?: number | null
        }
        Update: {
          captured_at?: string
          change_percent_24h?: number | null
          high_24h?: number | null
          id?: string
          low_24h?: number | null
          pair?: string
          price?: number
          volume_24h?: number | null
        }
        Relationships: []
      }
      monitored_assets: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          pair: string
          timeframes: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          pair: string
          timeframes?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          pair?: string
          timeframes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      opportunity_radar: {
        Row: {
          asset_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          metadata: Json
          reason: string
          score: number
          symbol: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          metadata?: Json
          reason: string
          score?: number
          symbol?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          reason?: string
          score?: number
          symbol?: string | null
        }
        Relationships: []
      }
      real_circuit_breaker_events: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          id: string
          message: string
          opened_at: string
          severity: string
          trigger: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          message: string
          opened_at?: string
          severity?: string
          trigger: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          message?: string
          opened_at?: string
          severity?: string
          trigger?: string
        }
        Relationships: []
      }
      real_orders: {
        Row: {
          asset_id: string | null
          binance_order_id: string | null
          binance_status: string | null
          filled_at: string | null
          id: string
          pair: string
          pnl: number | null
          pnl_pct: number | null
          price: number | null
          qty: number
          raw_response: Json | null
          request_id: string | null
          session_id: string | null
          side: string
          stop_loss: number | null
          submitted_at: string
          take_profit: number | null
          type: string
        }
        Insert: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          filled_at?: string | null
          id?: string
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          price?: number | null
          qty: number
          raw_response?: Json | null
          request_id?: string | null
          session_id?: string | null
          side: string
          stop_loss?: number | null
          submitted_at?: string
          take_profit?: number | null
          type?: string
        }
        Update: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          filled_at?: string | null
          id?: string
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          price?: number | null
          qty?: number
          raw_response?: Json | null
          request_id?: string | null
          session_id?: string | null
          side?: string
          stop_loss?: number | null
          submitted_at?: string
          take_profit?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "real_orders_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      real_positions: {
        Row: {
          asset_id: string | null
          closed_at: string | null
          entry_price: number
          exit_price: number | null
          exit_reason: string | null
          id: string
          last_price: number | null
          opened_at: string
          order_id: string | null
          pair: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          request_id: string | null
          side: string
          status: string
          stop_loss: number
          take_profit: number
        }
        Insert: {
          asset_id?: string | null
          closed_at?: string | null
          entry_price: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          last_price?: number | null
          opened_at?: string
          order_id?: string | null
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          request_id?: string | null
          side: string
          status?: string
          stop_loss: number
          take_profit: number
        }
        Update: {
          asset_id?: string | null
          closed_at?: string | null
          entry_price?: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          last_price?: number | null
          opened_at?: string
          order_id?: string | null
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          request_id?: string | null
          side?: string
          status?: string
          stop_loss?: number
          take_profit?: number
        }
        Relationships: [
          {
            foreignKeyName: "real_positions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "real_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_positions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      real_risk_limits: {
        Row: {
          daily_loss_limit: number
          id: number
          loss_streak_limit: number
          max_open_positions: number
          max_pct_portfolio: number
          max_per_trade: number
          max_trades_per_day: number
          monthly_loss_limit: number
          updated_at: string
          weekly_loss_limit: number
        }
        Insert: {
          daily_loss_limit?: number
          id?: number
          loss_streak_limit?: number
          max_open_positions?: number
          max_pct_portfolio?: number
          max_per_trade?: number
          max_trades_per_day?: number
          monthly_loss_limit?: number
          updated_at?: string
          weekly_loss_limit?: number
        }
        Update: {
          daily_loss_limit?: number
          id?: number
          loss_streak_limit?: number
          max_open_positions?: number
          max_pct_portfolio?: number
          max_per_trade?: number
          max_trades_per_day?: number
          monthly_loss_limit?: number
          updated_at?: string
          weekly_loss_limit?: number
        }
        Relationships: []
      }
      real_trade_approvals: {
        Row: {
          action: string
          approver_user_id: string
          created_at: string
          id: string
          ip: string | null
          note: string | null
          request_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          approver_user_id: string
          created_at?: string
          id?: string
          ip?: string | null
          note?: string | null
          request_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          approver_user_id?: string
          created_at?: string
          id?: string
          ip?: string | null
          note?: string | null
          request_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "real_trade_approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      real_trade_requests: {
        Row: {
          asset_id: string | null
          checklist: Json
          created_at: string
          decision_id: string | null
          expected_result: number | null
          expires_at: string | null
          id: string
          justification: string | null
          pair: string
          risk_amount: number
          score: number
          session_id: string | null
          side: string
          status: string
          stop_loss: number
          suggested_price: number
          suggested_qty: number
          take_profit: number
          updated_at: string
          vetoes: Json
          votes_against: number
          votes_for: number
          worst_case: number | null
        }
        Insert: {
          asset_id?: string | null
          checklist?: Json
          created_at?: string
          decision_id?: string | null
          expected_result?: number | null
          expires_at?: string | null
          id?: string
          justification?: string | null
          pair: string
          risk_amount: number
          score: number
          session_id?: string | null
          side: string
          status?: string
          stop_loss: number
          suggested_price: number
          suggested_qty: number
          take_profit: number
          updated_at?: string
          vetoes?: Json
          votes_against?: number
          votes_for?: number
          worst_case?: number | null
        }
        Update: {
          asset_id?: string | null
          checklist?: Json
          created_at?: string
          decision_id?: string | null
          expected_result?: number | null
          expires_at?: string | null
          id?: string
          justification?: string | null
          pair?: string
          risk_amount?: number
          score?: number
          session_id?: string | null
          side?: string
          status?: string
          stop_loss?: number
          suggested_price?: number
          suggested_qty?: number
          take_profit?: number
          updated_at?: string
          vetoes?: Json
          votes_against?: number
          votes_for?: number
          worst_case?: number | null
        }
        Relationships: []
      }
      reputation_history: {
        Row: {
          agent_id: string | null
          drawdown: number | null
          hit_rate: number | null
          id: string
          n_votes: number | null
          pnl_total: number | null
          snapshot_at: string
          weight: number | null
        }
        Insert: {
          agent_id?: string | null
          drawdown?: number | null
          hit_rate?: number | null
          id?: string
          n_votes?: number | null
          pnl_total?: number | null
          snapshot_at?: string
          weight?: number | null
        }
        Update: {
          agent_id?: string | null
          drawdown?: number | null
          hit_rate?: number | null
          id?: string
          n_votes?: number | null
          pnl_total?: number | null
          snapshot_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reputation_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          meta: Json | null
          session_id: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          meta?: Json | null
          session_id?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          meta?: Json | null
          session_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_incidents: {
        Row: {
          created_at: string
          data: Json
          id: string
          kind: string
          message: string | null
          resolved_at: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          kind: string
          message?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          message?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Relationships: []
      }
      robot_confidence: {
        Row: {
          accuracy_component: number | null
          agents_precision_component: number | null
          computed_at: string
          data_quality_component: number | null
          drawdown_component: number | null
          id: string
          performance_component: number | null
          score: number
        }
        Insert: {
          accuracy_component?: number | null
          agents_precision_component?: number | null
          computed_at?: string
          data_quality_component?: number | null
          drawdown_component?: number | null
          id?: string
          performance_component?: number | null
          score: number
        }
        Update: {
          accuracy_component?: number | null
          agents_precision_component?: number | null
          computed_at?: string
          data_quality_component?: number | null
          drawdown_component?: number | null
          id?: string
          performance_component?: number | null
          score?: number
        }
        Relationships: []
      }
      robot_settings: {
        Row: {
          active_timeframes: string[]
          alerts_telegram_enabled: boolean | null
          alerts_whatsapp_enabled: boolean | null
          binance_mock_mode: boolean
          collect_frequency_seconds: number
          daily_loss_limit: number | null
          default_stop_pct: number | null
          default_take_pct: number | null
          id: number
          max_loss_streak: number | null
          max_per_asset: number | null
          max_per_trade: number | null
          max_portfolio_exposure: number | null
          min_score_for_real: number
          mode: string
          monthly_loss_limit: number | null
          phase_ready: boolean | null
          production_assisted_enabled: boolean
          production_auto_enabled: boolean
          rate_limit_per_minute: number
          real_robot_paused: boolean
          require_manual_approval: boolean
          status: string
          updated_at: string
          weekly_loss_limit: number | null
        }
        Insert: {
          active_timeframes?: string[]
          alerts_telegram_enabled?: boolean | null
          alerts_whatsapp_enabled?: boolean | null
          binance_mock_mode?: boolean
          collect_frequency_seconds?: number
          daily_loss_limit?: number | null
          default_stop_pct?: number | null
          default_take_pct?: number | null
          id?: number
          max_loss_streak?: number | null
          max_per_asset?: number | null
          max_per_trade?: number | null
          max_portfolio_exposure?: number | null
          min_score_for_real?: number
          mode?: string
          monthly_loss_limit?: number | null
          phase_ready?: boolean | null
          production_assisted_enabled?: boolean
          production_auto_enabled?: boolean
          rate_limit_per_minute?: number
          real_robot_paused?: boolean
          require_manual_approval?: boolean
          status?: string
          updated_at?: string
          weekly_loss_limit?: number | null
        }
        Update: {
          active_timeframes?: string[]
          alerts_telegram_enabled?: boolean | null
          alerts_whatsapp_enabled?: boolean | null
          binance_mock_mode?: boolean
          collect_frequency_seconds?: number
          daily_loss_limit?: number | null
          default_stop_pct?: number | null
          default_take_pct?: number | null
          id?: number
          max_loss_streak?: number | null
          max_per_asset?: number | null
          max_per_trade?: number | null
          max_portfolio_exposure?: number | null
          min_score_for_real?: number
          mode?: string
          monthly_loss_limit?: number | null
          phase_ready?: boolean | null
          production_assisted_enabled?: boolean
          production_auto_enabled?: boolean
          rate_limit_per_minute?: number
          real_robot_paused?: boolean
          require_manual_approval?: boolean
          status?: string
          updated_at?: string
          weekly_loss_limit?: number | null
        }
        Relationships: []
      }
      seasonal_performance: {
        Row: {
          computed_at: string
          drawdown: number | null
          id: string
          metrics: Json
          net_pnl: number | null
          period: string
          profit_factor: number | null
          trades_count: number
          win_rate: number | null
        }
        Insert: {
          computed_at?: string
          drawdown?: number | null
          id?: string
          metrics?: Json
          net_pnl?: number | null
          period: string
          profit_factor?: number | null
          trades_count?: number
          win_rate?: number | null
        }
        Update: {
          computed_at?: string
          drawdown?: number | null
          id?: string
          metrics?: Json
          net_pnl?: number | null
          period?: string
          profit_factor?: number | null
          trades_count?: number
          win_rate?: number | null
        }
        Relationships: []
      }
      simulated_orders: {
        Row: {
          agents_against: number
          agents_favor: number
          closed_at: string | null
          closed_price: number | null
          created_at: string
          decision_id: string | null
          entry_price: number
          id: string
          justification: string | null
          pair: string
          quantity: number
          realized_pnl: number | null
          score: number
          side: string
          status: string
          stop_price: number | null
          target_price: number | null
        }
        Insert: {
          agents_against?: number
          agents_favor?: number
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          decision_id?: string | null
          entry_price: number
          id?: string
          justification?: string | null
          pair: string
          quantity: number
          realized_pnl?: number | null
          score?: number
          side: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
        }
        Update: {
          agents_against?: number
          agents_favor?: number
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          decision_id?: string | null
          entry_price?: number
          id?: string
          justification?: string | null
          pair?: string
          quantity?: number
          realized_pnl?: number | null
          score?: number
          side?: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simulated_orders_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      simulated_positions: {
        Row: {
          avg_price: number
          id: string
          pair: string
          quantity: number
          unrealized_pnl: number
          updated_at: string
        }
        Insert: {
          avg_price?: number
          id?: string
          pair: string
          quantity?: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Update: {
          avg_price?: number
          id?: string
          pair?: string
          quantity?: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Relationships: []
      }
      simulated_wallet: {
        Row: {
          current_balance: number
          equity: number
          id: number
          initial_balance: number
          updated_at: string
        }
        Insert: {
          current_balance?: number
          equity?: number
          id?: number
          initial_balance?: number
          updated_at?: string
        }
        Update: {
          current_balance?: number
          equity?: number
          id?: number
          initial_balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      strategic_memory: {
        Row: {
          asset_id: string | null
          content: string
          created_at: string
          embedding: string | null
          id: string
          kind: string
          metadata: Json
          ref_id: string | null
          ref_table: string | null
          title: string | null
        }
        Insert: {
          asset_id?: string | null
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          kind: string
          metadata?: Json
          ref_id?: string | null
          ref_table?: string | null
          title?: string | null
        }
        Update: {
          asset_id?: string | null
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          kind?: string
          metadata?: Json
          ref_id?: string | null
          ref_table?: string | null
          title?: string | null
        }
        Relationships: []
      }
      strategy_comparisons: {
        Row: {
          baseline_run_id: string | null
          created_at: string
          deltas: Json | null
          id: string
          name: string
          notes: string | null
          run_ids: Json
        }
        Insert: {
          baseline_run_id?: string | null
          created_at?: string
          deltas?: Json | null
          id?: string
          name: string
          notes?: string | null
          run_ids: Json
        }
        Update: {
          baseline_run_id?: string | null
          created_at?: string
          deltas?: Json | null
          id?: string
          name?: string
          notes?: string | null
          run_ids?: Json
        }
        Relationships: [
          {
            foreignKeyName: "strategy_comparisons_baseline_run_id_fkey"
            columns: ["baseline_run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_laboratory: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      strategy_simulations: {
        Row: {
          created_at: string
          expected_drawdown: number | null
          expected_pnl: number | null
          expected_winrate: number | null
          id: string
          lab_id: string | null
          notes: string | null
          params: Json
          results: Json
          score: number | null
        }
        Insert: {
          created_at?: string
          expected_drawdown?: number | null
          expected_pnl?: number | null
          expected_winrate?: number | null
          id?: string
          lab_id?: string | null
          notes?: string | null
          params?: Json
          results?: Json
          score?: number | null
        }
        Update: {
          created_at?: string
          expected_drawdown?: number | null
          expected_pnl?: number | null
          expected_winrate?: number | null
          id?: string
          lab_id?: string | null
          notes?: string | null
          params?: Json
          results?: Json
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_simulations_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "strategy_laboratory"
            referencedColumns: ["id"]
          },
        ]
      }
      supervisor_reviews: {
        Row: {
          anomalies: Json
          automated_trade_id: string | null
          checks: Json
          created_at: string
          data_quality_score: number | null
          id: string
          justification: string | null
          request_id: string | null
          verdict: string
        }
        Insert: {
          anomalies?: Json
          automated_trade_id?: string | null
          checks?: Json
          created_at?: string
          data_quality_score?: number | null
          id?: string
          justification?: string | null
          request_id?: string | null
          verdict: string
        }
        Update: {
          anomalies?: Json
          automated_trade_id?: string | null
          checks?: Json
          created_at?: string
          data_quality_score?: number | null
          id?: string
          justification?: string | null
          request_id?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervisor_reviews_automated_trade_id_fkey"
            columns: ["automated_trade_id"]
            isOneToOne: false
            referencedRelation: "automated_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisor_reviews_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string
          severity: string
          source: string
          technical_data: Json | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message: string
          severity?: string
          source: string
          technical_data?: Json | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          severity?: string
          source?: string
          technical_data?: Json | null
        }
        Relationships: []
      }
      testnet_orders: {
        Row: {
          asset_id: string | null
          binance_order_id: string | null
          binance_status: string | null
          created_at: string
          filled_at: string | null
          id: string
          pair: string
          pnl: number | null
          price: number | null
          qty: number
          raw_response: Json | null
          session_id: string | null
          side: string
          stop_loss: number | null
          take_profit: number | null
          type: string
        }
        Insert: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          created_at?: string
          filled_at?: string | null
          id?: string
          pair: string
          pnl?: number | null
          price?: number | null
          qty: number
          raw_response?: Json | null
          session_id?: string | null
          side: string
          stop_loss?: number | null
          take_profit?: number | null
          type?: string
        }
        Update: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          created_at?: string
          filled_at?: string | null
          id?: string
          pair?: string
          pnl?: number | null
          price?: number | null
          qty?: number
          raw_response?: Json | null
          session_id?: string | null
          side?: string
          stop_loss?: number | null
          take_profit?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "testnet_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "testnet_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_explanations: {
        Row: {
          content: string
          created_at: string
          generated_by: string | null
          id: string
          position_id: string | null
          request_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          generated_by?: string | null
          id?: string
          position_id?: string | null
          request_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          generated_by?: string | null
          id?: string
          position_id?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      trading_sessions: {
        Row: {
          created_at: string
          current_balance: number
          id: string
          initial_balance: number
          meta: Json | null
          mode: string
          reason: string | null
          started_at: string
          status: string
          stopped_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          meta?: Json | null
          mode: string
          reason?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          meta?: Json | null
          mode?: string
          reason?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          agent_ranking: Json
          content: string | null
          created_at: string
          id: string
          performance: Json
          problem_assets: Json
          suggested_adjustments: string | null
          top_assets: Json
          week_end: string
          week_start: string
        }
        Insert: {
          agent_ranking?: Json
          content?: string | null
          created_at?: string
          id?: string
          performance?: Json
          problem_assets?: Json
          suggested_adjustments?: string | null
          top_assets?: Json
          week_end: string
          week_start: string
        }
        Update: {
          agent_ranking?: Json
          content?: string | null
          created_at?: string
          id?: string
          performance?: Json
          problem_assets?: Json
          suggested_adjustments?: string | null
          top_assets?: Json
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner: { Args: never; Returns: boolean }
      match_expert_chunks: {
        Args: {
          p_expert_id: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_strategic_memory: {
        Args: {
          p_asset_id?: string
          p_kind?: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          asset_id: string
          content: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          similarity: number
          title: string
        }[]
      }
    }
    Enums: {
      app_role: "owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner"],
    },
  },
} as const
