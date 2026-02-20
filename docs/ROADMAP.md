# 短期目标

> 唯一规划文件。所有条目完成前不得开发新功能。
> 完成后删除该条目并提交。新需求追加到末尾。

- Tool Context Eviction：tool call 结果自动压缩 + 按需召回，降低 context 膨胀。retention counter（LRU + frequency boost）控制保留回合数，每个 tool 定义初始 N（ephemeral=0 / compressible=2~3 / persistent=∞）；recall 时 retention 倍增（m*N）。message transformer 在构建 LLM messages 时将过期 tool call 对（assistant+tool）坍缩为单条 summary assistant message + recall_id；原文存外部 KV；暴露 recall_tool_result MCP tool 供 LLM 按需取回；subagent 链（langfuse.compile → subagent.run_text）为最高优先压缩目标

