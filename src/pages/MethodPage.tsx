import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Gauge, GitBranch, Info, Layers, Ruler, ShieldQuestion, Split, Thermometer } from 'lucide-react';
import { Panel } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { useStore } from '../state/store';
import { DEFAULT_CONFIG } from '../types';
import { pct } from '../lib/format';

export function MethodPage() {
  const state = useStore();
  const cfg = state.config ?? DEFAULT_CONFIG;

  return (
    <>
      <PageHead
        title="方法与规则"
        lede="这份说明回答三个问题：结论是怎么算出来的、阈值为什么这样定、以及工具明确不做什么。所有规则参数会随运行快照一起保存。"
      />

      <CalloutBlock />

      <div className="grid c2">
        <Panel title="为什么以「楼栋 × 供热日」为底表" sub="总体判断与解释线索分离" >
          <p className="tiny" style={{ color: 'var(--ink-2)', lineHeight: 1.8 }}>
            如果围绕每条投诉去截取附近探头和工单，工具会直接回答“投诉发生时有什么证据”，但探头缺失的楼栋容易被排除在视野之外，投诉密集的区域也会主导整体判断。
          </p>
          <p className="tiny" style={{ color: 'var(--ink-2)', lineHeight: 1.8, marginTop: 8 }}>
            本工具先为每栋楼建立按供热日排列的监测覆盖面，再把投诉作为解释线索关联进去。代价是需要维护楼栋、探头和地址映射；部分投诉会因无法准确定位而保持未归属。
          </p>
          <div className="callout info" style={{ marginTop: 10 }}>
            <Info size={14} color="var(--cool)" />
            <div className="tiny-2">
              覆盖不足的楼栋单独标为「无法判断」，不会因为“没有投诉”或“没有低温片段”被读成没有供热问题。
            </div>
          </div>
        </Panel>

        <Panel title="时间对齐" sub="本地供热日，而不是自然日">
          <div className="stack">
            <Rule icon={<Layers size={13} color="var(--teal)" />} title="供热日边界">
              每天 <b>{String(cfg.heatingDayStartHour).padStart(2, '0')}:00</b> 开始，到次日同点结束。夜间停供因此落在同一个供热日内，不会被拆成两半。
            </Rule>
            <Rule icon={<Thermometer size={13} color="var(--accent)" />} title="读数切分">
              每条室温读数按时间戳归入供热日；不同上传频率（10/15/30 分钟）分别按自身间隔推算应到条数。
            </Rule>
            <Rule icon={<Activity size={13} color="var(--cool)" />} title="气象插值">
              气象站 30 分钟观测；相邻观测间隔不超过 3 小时时线性插值，超出则视为缺测。
            </Rule>
            <Rule icon={<GitBranch size={13} color="var(--medium)" />} title="工单交集">
              停供 / 阀门调整 / 检修工单按楼栋别名定位，与低温片段按时间重叠判定；无法定位的工单单独列为对齐问题。
            </Rule>
          </div>
        </Panel>
      </div>

      <Panel title="判定路径" sub="分类是确定性规则的结果，不是黑箱评分。">
        <div className="stack" style={{ gap: 10 }}>
          <Step n={1} title="覆盖检查">
            该楼栋当日是否有探头、日覆盖是否 ≥ <b>{(cfg.minCoverageRatio * 100).toFixed(0)}%</b>、夜间覆盖 ≥ <b>{(cfg.minNightCoverageRatio * 100).toFixed(0)}%</b>。任一不足 → <b>覆盖不足</b>，不参与风险判断。
          </Step>
          <Step n={2} title="基线">
            对每个探头取窗口内稳定日的日中位数作为基线，保留 p20–p80 作为不确定范围。稳定日不足 <b>{cfg.baselineMinDays}</b> 天 → 基线不可用。
          </Step>
          <Step n={3} title="低温片段">
            读数同时低于舒适阈值 <b>{cfg.comfortThresholdC}℃</b> 且低于自身基线 <b>{cfg.deficitDeltaC}℃</b> 的连续片段，允许 20 分钟内合并。
          </Step>
          <Step n={4} title="形态判定">
            连续低温片段 ≤ <b>{cfg.windowOpeningMaxMinutes}</b> 分钟 → <b>短时扰动</b>（不作为停供证据）；影响探头占比 ≤ 50% 且超过短时上限 → <b>局部设备问题</b>；覆盖多数探头且持续 ≥ <b>{cfg.sustainedMinHours}</b> 小时，或有停供工单印证 → <b>供热不足</b>。
          </Step>
          <Step n={5} title="对齐校验">
            工单记录停供但读数未出现低温 → <b>对齐不可靠</b>。这是监测与工单矛盾，不等于“没有供热不足”。
          </Step>
          <Step n={6} title="投诉支持度">
            投诉窗口（前后扩展 <b>{cfg.complaintPaddingMin}</b> 分钟）内：持续低温覆盖过半 → <b>有据可查</b>；仅局部/部分重叠 → <b>部分支持</b>；无探头或覆盖不足 → <b>无法核实</b>；工单与监测矛盾 → <b>无法对齐</b>；地址无法唯一归属 → <b>未归属</b>。
          </Step>
        </div>
      </Panel>

      <div className="grid c2">
        <Panel title="地址归属规则" sub="宁可留白，不做最相似匹配">
          <ul className="bullet-list">
            <li><span>地址中包含登记楼栋名称或别名，且不与其他楼栋冲突时自动归属。</span></li>
            <li><span>同时命中多个楼栋、分值接近 → <b>保持未归属</b>，列出候选，等待人工确认；不会强行挑一个。</span></li>
            <li><span>人工确认优先于自动匹配；确认记录带窗口标签，不同窗口判断不一致时保存前必须处理冲突。</span></li>
            <li><span>单元号只作为增益信号，不能单独证明归属；探头不在该单元时不会自动加分。</span></li>
          </ul>
        </Panel>

        <Panel title="本工具明确不做的事">
          <ul className="bullet-list info">
            <li><span>不把室温单点测量当作楼栋全部住户的代表。</span></li>
            <li><span>不把探头缺失楼栋的“零投诉”当作低风险证据。</span></li>
            <li><span>不用运行后到达的数据回写历史结论；迟到数据只提示覆盖截止点。</span></li>
            <li><span>不上传任何真实住户资料；数据只保存在浏览器本地。</span></li>
            <li><span>不替代现场核查或对供热企业的最终归责判断。</span></li>
          </ul>
        </Panel>
      </div>

      <Panel title="探头位置偏差与风险敏感性：两条并行路线" sub="同一楼层两只探头长期偏低，既可能是外墙安装的空间差异，也可能是探头漂移；工具不替审查人二选一，而是给出可回查的证据与区间。">
        <div className="grid c2">
          <div>
            <h3 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>路线 A：固定安装分层的稳健邻近比较</h3>
            <ul className="bullet-list">
              <li><span>只在<b>相同供热日、室外温度带宽 ±{cfg.biasWeatherBandC}℃、双方覆盖率差 ≤ {cfg.biasCoverageTolerance}</b> 的条件下配对比较，取当日中位数之差。</span></li>
              <li><span>每个探头按更换、外墙改造、重新校准的事件时间<b>拆段</b>，每段独立计算稳健中位差与 MAD，逐项比较点可在「位置偏差」页逐点回查。</span></li>
              <li><span>自动校正门控须同时满足：位置证据编号存在、校准证书在段内有效、可比供热日 ≥ {cfg.biasMinComparableDays} 天、持续中位差达到 {cfg.biasMinPersistentDeltaC}℃ 且方向稳定、证书示值偏差不与邻近证据反向冲突。</span></li>
              <li><span>优点是证据逐项可审查、不需要训练历史模型；局限是布局稀疏或改造后可比探头不足时只能报告「不可比」，不产生调整视图。</span></li>
            </ul>
          </div>
          <div>
            <h3 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>路线 B：含位置与天气协变量的层级模型</h3>
            <ul className="bullet-list">
              <li><span>模型形式：<span className="mono tiny-2">y = 供热日固定效应(吸收天气) + 楼栋截距 + 外墙/冷朝向/楼层/房间类型固定效应 + 探头随机效应 u + ε</span>。</span></li>
              <li><span>探头随机效应做经验贝叶斯收缩：单探头样本少时向同楼栋/同类型总体靠拢，并给出基于残差 MAD 的 {pct(cfg.biasModelIntervalLevel)} 预测区间。</span></li>
              <li><span>楼栋内有效探头少于 {cfg.biasModelMinProbes} 个时回退全小区池化，并明确标注<b>适用范围</b>（仅可外推到相同外墙/朝向/房间类型）；池化仍不足则标记模型不适用。</span></li>
              <li><span><b>模型估计永远不被当作实测</b>：它只用于界定位置效应与漂移的不可区分区间，门控不放行时不产生任何自动校正。</span></li>
            </ul>
          </div>
        </div>
        <div className="callout warn" style={{ marginTop: 12 }}>
          <GitBranch size={15} color="var(--medium)" />
          <div className="tiny-2" style={{ lineHeight: 1.7 }}>
            <strong>三视图与不自动校正原则。</strong>
            原始视图（原始读数、原始风险，永不改写）→ 证据支持的偏差调整视图（仅门控通过段生效）→ 位置效应/漂移不可区分区间（证书过期、位置证据或邻近覆盖不足时，结论只给区间不给校正）。
            真实局部停供发生在事件时间轴上，与稳定位置偏差形态不同，调整视图不会抹除停供工单与持续低温证据；补证只生成新运行，设备档案、位置证据、风险计算与报告引用同一版本快照。
          </div>
        </div>
      </Panel>

      <Panel title="本次运行实际使用的参数" sub="参数随运行快照保存，历史运行不受后续修改影响。">
        <div className="grid c3">
          {[
            ['分析窗口', `${cfg.windowStartDay} → ${cfg.windowEndDay}`],
            ['供热日起点', `${cfg.heatingDayStartHour}:00`],
            ['舒适阈值', `${cfg.comfortThresholdC}℃`],
            ['严重偏低', `${cfg.severeThresholdC}℃`],
            ['相对基线下降', `${cfg.deficitDeltaC}℃`],
            ['持续不足阈值', `${cfg.sustainedMinHours} 小时`],
            ['短时扰动上限', `${cfg.windowOpeningMaxMinutes} 分钟`],
            ['夜间时段', `${cfg.nightStartHour}:00 → ${cfg.nightEndHour}:00`],
            ['覆盖下限（日/夜）', `${(cfg.minCoverageRatio * 100).toFixed(0)}% / ${(cfg.minNightCoverageRatio * 100).toFixed(0)}%`],
            ['基线稳定日', `${cfg.baselineMinDays} 天`],
            ['投诉时段扩展', `${cfg.complaintPaddingMin} 分钟`],
            ['地址匹配下限', cfg.complaintMatchMinScore.toFixed(2)],
          ].map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <span className="tiny muted">{k}</span>
              <span className="mono tiny">{v}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Link to="/runs" className="btn">
            <Gauge size={13} /> 去运行页调整参数
          </Link>
          <div className="spacer" />
          <Link to="/reports" className="btn ghost">
            查看最近一次报告 <ArrowRight size={13} />
          </Link>
        </div>
      </Panel>
    </>
  );
}

function CalloutBlock() {
  return (
    <div className="callout info">
      <Ruler size={15} color="var(--cool)" />
      <div className="tiny" style={{ lineHeight: 1.7 }}>
        <strong>三类结论：</strong>持续供热不足（覆盖多数探头、持续超过阈值，常有停供工单）、局部设备故障（单个探头或部分单元偏低，常有阀门/检修工单）、监测与投诉无法可靠对齐（工单与读数矛盾、探头缺失、覆盖不足）。
        短时开窗属于第四类「短时扰动」，只解释体感，不作为停供证据。
      </div>
    </div>
  );
}

function Rule({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
      <div style={{ marginTop: 2 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 580 }}>{title}</div>
        <div className="tiny" style={{ color: 'var(--ink-2)', lineHeight: 1.7 }}>{children}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--accent-dim)',
          border: '1px solid rgba(240,163,94,0.3)',
          color: 'var(--accent-2)',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {n}
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 580 }}>{title}</div>
        <div className="tiny" style={{ color: 'var(--ink-2)', lineHeight: 1.75 }}>{children}</div>
      </div>
    </div>
  );
}
