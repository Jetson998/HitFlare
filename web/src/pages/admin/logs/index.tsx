import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Form, Input, Select, Space, Table, Tabs, Tag, type TableProps } from "antd";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/stores/use-user-store";
import { fetchAdminLogs, fetchTaskCallLogs, type CallLog, type AuditLog, type ApplicationErrorLog } from "@/services/api/management";

const value=(input:unknown)=>input===null || input===undefined?"未返回":String(input);
const callColumns:TableProps<CallLog>["columns"]=[
    {title:"时间",dataIndex:"createdAt",width:180,render:input=>new Date(input).toLocaleString()},
    {title:"用户 / 模型",width:210,render:(_,row)=><><div>{row.ownerUserId}</div><div className="text-xs text-muted-foreground">{row.model}</div></>},
    {title:"任务 / 调用",width:250,render:(_,row)=><><div className="break-all text-xs">{row.taskId}</div><div className="break-all text-xs text-muted-foreground">{row.callId}</div></>},
    {title:"状态",dataIndex:"status",width:100,render:input=><Tag color={input==="failed"?"error":input==="succeeded"?"success":"default"}>{({prepared:"待调用",running:"进行中",accepted:"已受理",succeeded:"成功",failed:"失败",cancelled:"已取消",unknown:"结果未知",interrupted:"已中断"} as Record<string,string>)[input] || input}</Tag>},
    {title:"上游 HTTP / code",width:180,render:(_,row)=><><div>{value(row.upstreamHttpStatus)}</div><div className="break-all text-xs">{value(row.upstreamErrorCode)}</div></>},
    {title:"应用 HTTP / code",width:180,render:(_,row)=><><div>{value(row.appHttpStatus)}</div><div className="break-all text-xs">{value(row.appErrorCode)}</div></>},
    {title:"来源 / usage",width:140,render:(_,row)=><><div className="text-xs">{row.reportSource==="server_observed"?"服务端观测":"浏览器上报"}</div><div className="text-xs text-muted-foreground">{row.usage?"已返回用量":"未返回用量"}</div></>},
];
const auditColumns:TableProps<AuditLog>["columns"]=[{title:"时间",dataIndex:"createdAt",render:input=>new Date(input).toLocaleString()},{title:"操作者",dataIndex:"actorUserId"},{title:"目标",dataIndex:"targetId",render:value},{title:"动作",dataIndex:"action"},{title:"结果",dataIndex:"result",render:input=>input==="succeeded"?"成功":"失败"},{title:"requestId",dataIndex:"requestId",render:value},{title:"错误码",dataIndex:"errorCode",render:value}];
const errorColumns:TableProps<ApplicationErrorLog>["columns"]=[{title:"时间",dataIndex:"createdAt",render:input=>new Date(input).toLocaleString()},{title:"用户",dataIndex:"ownerUserId",render:value},{title:"请求",render:(_,row)=>`${row.method} ${row.route}`},{title:"应用 HTTP",dataIndex:"appHttpStatus"},{title:"应用错误码",dataIndex:"appErrorCode"},{title:"requestId",dataIndex:"requestId"}];
const filterFields=[ ["userId","用户 ID"],["channelId","渠道 ID"],["model","模型"],["taskId","taskId"],["callId","callId"],["requestId","requestId"],["upstreamHttpStatus","上游 HTTP 状态"],["upstreamErrorCode","上游 code"],["upstreamErrorType","上游 type"],["upstreamRequestId","供应商 request ID"],["appHttpStatus","应用 HTTP 状态"],["appErrorCode","应用错误码"],["action","管理动作"],["from","起始时间（ISO）"],["to","结束时间（不含）"] ];

export default function AdminLogsPage() {
    const navigate=useNavigate(),identity=useUserStore(state=>state.user?.sessionId);
    const [form]=Form.useForm<Record<string,string>>();
    const [filters,setFilters]=useState<Record<string,string>>({}),[detail,setDetail]=useState<Record<string,unknown>|null>(null);
    useEffect(()=>{setDetail(null);setFilters({});form.resetFields();},[identity,form]);
    const query=useQuery({queryKey:["admin-logs",identity,filters],queryFn:()=>fetchAdminLogs(filters),enabled:Boolean(identity)}),summary=query.data?.summary;
    return <main className="h-full overflow-y-auto bg-background"><div className="workspace-page">
        <div className="workspace-heading"><div className="workspace-heading-copy"><h1 className="workspace-title">管理日志</h1><p className="workspace-description">管理操作、模型调用与应用错误，可按任务展开每次调用</p></div><Space><Button onClick={()=>navigate("/admin/users")}>用户管理</Button><Button onClick={()=>navigate("/admin/storage")}>存储诊断</Button><Button icon={<RefreshCw className="size-4"/>} loading={query.isFetching} onClick={()=>void query.refetch()}>刷新</Button></Space></div>
        <Form form={form} layout="vertical" onFinish={values=>setFilters(values)} className="mb-4">
            <div className="grid grid-cols-2 gap-x-3 lg:grid-cols-4 xl:grid-cols-5">{filterFields.map(([key,label])=><Form.Item key={key} name={key} label={label} className="mb-3"><Input allowClear placeholder={label}/></Form.Item>)}<Form.Item name="status" label="调用状态"><Select allowClear options={["prepared","running","accepted","succeeded","failed","unknown","cancelled","interrupted"].map(status=>({value:status,label:({prepared:"待调用",running:"进行中",accepted:"已受理",succeeded:"成功",failed:"失败",unknown:"结果未知",cancelled:"已取消",interrupted:"已中断"} as Record<string,string>)[status]}))}/></Form.Item></div>
            <Space><Button type="primary" htmlType="submit">查询</Button><Button onClick={()=>{form.resetFields();setFilters({});}}>重置筛选</Button></Space>
        </Form>
        {query.isError?<Alert type="error" showIcon description={query.error.message} className="mb-4"/>:null}
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="log-summary"><span>任务 {summary?.taskCount ?? 0}</span><span>实际调用 {summary?.callCount ?? 0}</span><span>输出 {summary?.producedOutputCount ?? 0}</span><span>已保存 {summary?.savedOutputCount ?? 0}</span><span>非消费操作 {summary?.operationCount ?? 0}</span><span>用量未返回 {summary?.usageMissingCallCount ?? 0}</span></div>
        {summary?.usageTotals?<Descriptions size="small" title="已返回用量汇总" items={Object.entries(summary.usageTotals).map(([key,count])=>({key,label:key,children:count}))}/>:null}
        {summary?.costByCurrency?<Descriptions size="small" title="供应商返回费用" items={Object.entries(summary.costByCurrency).map(([key,cost])=>({key,label:key,children:cost}))}/>:null}
        <Tabs items={[
            {key:"calls",label:"模型调用",children:<Table<CallLog> rowKey="callId" size="small" columns={[...callColumns,{title:"详情",fixed:"right",width:80,render:(_,row)=><Button type="text" size="small" onClick={()=>setDetail({...row})}>查看</Button>}]} dataSource={query.data?.calls || []} loading={query.isPending} scroll={{x:1400}} expandable={{expandedRowRender:row=><TaskCalls call={row}/>}} pagination={{pageSize:20,showSizeChanger:false}}/>},
            {key:"audit",label:"管理与账号审计",children:<Table<AuditLog> rowKey="id" size="small" columns={auditColumns} dataSource={query.data?.audit || []} loading={query.isPending} scroll={{x:1200}} pagination={{pageSize:20,showSizeChanger:false}}/>},
            {key:"errors",label:"应用错误",children:<Table<ApplicationErrorLog> rowKey="id" size="small" columns={errorColumns} dataSource={query.data?.errors || []} loading={query.isPending} scroll={{x:1200}} pagination={{pageSize:20,showSizeChanger:false}}/>},
            {key:"operations",label:"轮询、保存等操作",children:<Table<Record<string,unknown>> rowKey={row=>String(row.operationId)} size="small" columns={[{title:"时间",dataIndex:"createdAt",render:value},{title:"任务",dataIndex:"taskId",render:value},{title:"调用",dataIndex:"callId",render:value},{title:"阶段",dataIndex:"failureStage",render:value},{title:"上游 HTTP",dataIndex:"upstreamHttpStatus",render:value},{title:"应用错误码",dataIndex:"appErrorCode",render:value},{title:"详情",render:(_,row)=><Button type="text" onClick={()=>setDetail(row)}>查看</Button>}]} dataSource={query.data?.operations || []} scroll={{x:1100}} pagination={{pageSize:20,showSizeChanger:false}}/>},
        ]}/>
        <Drawer title="日志元数据" open={Boolean(detail)} onClose={()=>setDetail(null)} size={600} destroyOnHidden><pre className="whitespace-pre-wrap break-all text-xs leading-6">{JSON.stringify(detail,null,2)}</pre></Drawer>
    </div></main>;
}
function TaskCalls({call}:{call:CallLog}) {
    const identity=useUserStore(state=>state.user?.sessionId);
    const query=useQuery({queryKey:["admin-task-calls",identity,call.taskType,call.taskId],queryFn:()=>fetchTaskCallLogs(call.taskId,call.taskType,call.ownerUserId)});
    return <div className="py-2"><p className="mb-2 text-sm">该任务全部调用（保留其他状态及重试）</p>{query.isError?<Alert type="error" description={query.error.message}/>:<Table<CallLog> size="small" rowKey="callId" columns={callColumns} dataSource={query.data?.calls || []} loading={query.isPending} pagination={false} scroll={{x:1300}}/>}</div>;
}
