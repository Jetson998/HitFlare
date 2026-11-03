import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Form, Input, Select, Space, Table, Tabs, Tag, type TableProps } from "antd";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchUsers } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { fetchAdminLogs, type CallLog, type AuditLog, type ApplicationErrorLog } from "@/services/api/management";

const value=(input:unknown)=>input===null || input===undefined?"未返回":String(input);
const pages:Record<string,string>={agent:"Agent",reverse:"反推提示词",image:"图片创作",video:"视频创作"};
const stages:Record<string,string>={agent:"创作",observe:"图片观察",refine:"提示词精修",generate:"生成",create:"创建视频"};
const duration=(row:CallLog)=>row.durationMs===null?"未返回":`${(row.durationMs/1000).toFixed(1)} 秒`;
const callColumns:TableProps<CallLog>["columns"]=[
    {title:"时间",dataIndex:"createdAt",width:142,render:input=>new Date(input).toLocaleString()},
    {title:"用户",width:96,render:(_,row)=><div>{row.username || "用户名未关联"}</div>},
    {title:"页面",dataIndex:"taskType",width:110,render:input=>pages[input] || input},
    {title:"操作",dataIndex:"stage",width:88,render:input=>input?stages[input] || input:"未返回"},
    {title:"响应时间",width:78,render:(_,row)=>duration(row)},
    {title:"模型",dataIndex:"model",width:180},
    {title:"状态",dataIndex:"status",width:100,render:input=><Tag color={input==="failed"?"error":input==="succeeded"?"success":"default"}>{({prepared:"待调用",running:"进行中",accepted:"已受理",succeeded:"成功",failed:"失败",cancelled:"已取消",unknown:"结果未知",interrupted:"已中断"} as Record<string,string>)[input] || input}</Tag>},
];
const auditColumns:TableProps<AuditLog>["columns"]=[{title:"时间",dataIndex:"createdAt",render:input=>new Date(input).toLocaleString()},{title:"操作者",render:(_,row)=><><div>{row.actorUsername || "用户名未关联"}</div><div className="break-all text-[13px] text-muted-foreground">{row.actorUserId}</div></>},{title:"目标",render:(_,row)=><>{row.targetUsername?<div>{row.targetUsername}</div>:null}<div className="break-all text-[13px] text-muted-foreground">{value(row.targetId)}</div></>},{title:"动作",dataIndex:"action"},{title:"结果",dataIndex:"result",render:input=>input==="succeeded"?"成功":"失败"},{title:"requestId",dataIndex:"requestId",render:value},{title:"错误码",dataIndex:"errorCode",render:value}];
const errorColumns:TableProps<ApplicationErrorLog>["columns"]=[{title:"时间",dataIndex:"createdAt",render:input=>new Date(input).toLocaleString()},{title:"用户",render:(_,row)=><>{row.username?<div>{row.username}</div>:null}<div className="break-all text-[13px] text-muted-foreground">{value(row.ownerUserId)}</div></>},{title:"请求",render:(_,row)=>`${row.method} ${row.route}`},{title:"应用 HTTP",dataIndex:"appHttpStatus"},{title:"应用错误码",dataIndex:"appErrorCode"},{title:"requestId",dataIndex:"requestId"}];
const statusOptions=["prepared","running","accepted","succeeded","failed","unknown","cancelled","interrupted"].map(status=>({value:status,label:({prepared:"待调用",running:"进行中",accepted:"已受理",succeeded:"成功",failed:"失败",unknown:"结果未知",cancelled:"已取消",interrupted:"已中断"} as Record<string,string>)[status]}));
const pageOptions=[["agent","Agent"],["reverse","反推提示词"],["image","图片创作"],["video","视频创作"]].map(([value,label])=>({value,label}));
const modelTypeOptions=[["text","Agent 文本模型"],["image","图片生成模型"],["video","视频模型"],["audio","音频模型"]].map(([value,label])=>({value,label}));
const filterFields=[ ["channelId","渠道名称"],["callId","调用编号"],["requestId","请求编号"],["upstreamHttpStatus","上游 HTTP 状态"],["upstreamErrorCode","上游错误码"],["upstreamErrorType","上游错误类型"],["upstreamRequestId","供应商请求编号"],["appHttpStatus","应用 HTTP 状态"],["appErrorCode","应用错误码"],["action","管理动作"],["from","起始时间"],["to","结束时间"] ];

export default function AdminLogsPage() {
    const navigate=useNavigate(),identity=useUserStore(state=>state.user?.sessionId);
    const [form]=Form.useForm<Record<string,string>>();
    const [filters,setFilters]=useState<Record<string,string>>({}),[detail,setDetail]=useState<Record<string,unknown>|null>(null),[more,setMore]=useState(false);
    useEffect(()=>{setDetail(null);setFilters({});form.resetFields();},[identity,form]);
    const query=useQuery({queryKey:["admin-logs",identity,filters],queryFn:()=>fetchAdminLogs(filters),enabled:Boolean(identity)}),summary=query.data?.summary;
    const users=useQuery({queryKey:["admin-users",identity],queryFn:fetchUsers,enabled:Boolean(identity)});
    const userOptions=(users.data?.users || []).map(user=>({value:user.username,label:user.username}));
    const modelOptions=(query.data?.options?.models || []).map(model=>({value:model,label:model}));
    return <main className="h-full overflow-y-auto bg-background"><div className="workspace-page text-[13px] [&_.ant-btn]:text-[13px] [&_.ant-input]:text-[13px] [&_.ant-select-selection-item]:text-[13px] [&_.ant-select-selection-placeholder]:text-[13px] [&_.ant-form-item-label>label]:text-[13px] [&_.ant-collapse-header]:text-[13px] [&_.ant-tabs-tab]:text-[13px] [&_.ant-table]:text-[13px] [&_.ant-tag]:text-[13px] [&_.ant-pagination]:text-[13px] [&_.workspace-title]:text-base [&_.workspace-title]:leading-6">
        <div className="workspace-heading"><div className="min-w-0"><h1 className="workspace-title">管理日志</h1><p className="workspace-description">管理操作、模型调用与应用错误</p></div><Space wrap><Button onClick={()=>navigate("/admin/users")}>用户管理</Button><Button onClick={()=>navigate("/admin/storage")}>存储诊断</Button><Button icon={<RefreshCw className="size-4"/>} loading={query.isFetching} onClick={()=>void query.refetch()}>刷新</Button></Space></div>
        <section className="border-b border-stone-200 pb-4 dark:border-stone-800"><Form form={form} layout="vertical" onFinish={values=>setFilters(values)} className="[&_.ant-form-item]:mb-0">
            <div className="flex flex-wrap items-end gap-2">{[["username","用户名",userOptions],["page","页面",pageOptions],["modelType","模型类型",modelTypeOptions],["model","模型名称",modelOptions],["status","调用状态",statusOptions]].map(([name,label,options])=><Form.Item key={name} name={name} label={label} className="w-[168px]"><Select allowClear showSearch optionFilterProp="label" placeholder={label} options={options} loading={name==="username"?users.isPending:false}/></Form.Item>)}<Form.Item label=" " className="[&_.ant-form-item-label]:invisible"><div className="flex h-8 items-center gap-2"><Button type="text" className="!px-0" onClick={()=>setMore(value=>!value)}>{more?"收起筛选":"更多筛选"}</Button><Button type="primary" htmlType="submit">查询</Button><Button onClick={()=>{form.resetFields();setFilters({});}}>重置筛选</Button></div></Form.Item></div>{more?<div className="mt-3 flex max-w-[920px] flex-wrap gap-2">{filterFields.map(([key,label])=><Form.Item key={key} name={key} label={label} className="w-[168px]"><Input allowClear placeholder={label}/></Form.Item>)}</div>:null}
        </Form>{query.isError?<Alert type="error" showIcon description={query.error.message} className="mt-3"/>:null}</section>
<section className="pt-3"><Tabs items={[
            {key:"calls",label:`模型调用 ${query.data?.summary.callCount ?? 0}`,children:<Table<CallLog> rowKey="callId" size="small" columns={[...callColumns,{title:"详情",fixed:"right",width:80,render:(_,row)=><Button type="text" size="small" onClick={()=>setDetail({...row})}>查看</Button>}]} dataSource={query.data?.calls || []} loading={query.isPending}  expandable={{expandedRowRender:row=><CallDetails call={row}/>}} pagination={{pageSize:20,showSizeChanger:false}}/>},
            {key:"audit",label:`管理与账号审计 ${query.data?.audit.length ?? 0}`,children:<Table<AuditLog> rowKey="id" size="small" columns={auditColumns} dataSource={query.data?.audit || []} loading={query.isPending} scroll={{x:1200}} pagination={{pageSize:20,showSizeChanger:false}}/>},
            {key:"errors",label:`应用错误 ${query.data?.errors.length ?? 0}`,children:<Table<ApplicationErrorLog> rowKey="id" size="small" columns={errorColumns} dataSource={query.data?.errors || []} loading={query.isPending} scroll={{x:1200}} pagination={{pageSize:20,showSizeChanger:false}}/>},
            {key:"operations",label:`附属操作 ${query.data?.summary.operationCount ?? 0}`,children:<Table<Record<string,unknown>> rowKey={row=>String(row.operationId)} size="small" columns={[{title:"时间",dataIndex:"createdAt",render:value},{title:"用户",render:(_,row)=><>{row.username?<div>{String(row.username)}</div>:null}<div className="break-all text-[13px] text-muted-foreground">{value(row.ownerUserId)}</div></>},{title:"任务",dataIndex:"taskId",render:value},{title:"调用",dataIndex:"callId",render:value},{title:"阶段",dataIndex:"failureStage",render:value},{title:"上游 HTTP",dataIndex:"upstreamHttpStatus",render:value},{title:"应用错误码",dataIndex:"appErrorCode",render:value},{title:"详情",render:(_,row)=><Button type="text" onClick={()=>setDetail(row)}>查看</Button>}]} dataSource={query.data?.operations || []} scroll={{x:1100}} pagination={{pageSize:20,showSizeChanger:false}}/>},
        ]}/></section>
        <Drawer title="日志元数据" open={Boolean(detail)} onClose={()=>setDetail(null)} size={600} destroyOnHidden styles={{ wrapper: { width: "min(600px, 100vw)" } }}><pre className="whitespace-pre-wrap break-all text-[13px] leading-6">{JSON.stringify(detail,null,2)}</pre></Drawer>
    </div></main>;
}
function CallDetails({call}:{call:CallLog}) {
    const groups:[string,[string,unknown][]][]=[
        ["调用",[["任务",call.taskId],["调用",call.callId],["渠道",call.channelId],["执行位置",call.executionMode==="server"?"服务端":"浏览器"],["第几次",call.attemptNo],["重试来源",call.retryOfCallId]]],
        ["供应商返回",[["上游 HTTP",call.upstreamHttpStatus],["上游报错",call.upstreamErrorMessage || call.upstreamErrorCode],["来源",call.reportSource==="server_observed"?"服务端观测":"浏览器上报"]]],
        ["应用结果",[["应用 HTTP",call.appHttpStatus],["应用错误码",call.appErrorCode],["输出数量",call.producedOutputCount]]],
        ["用量",[["用量",call.usage?"已返回":"未返回"],["用量来源",call.usageSource],...Object.entries(call.usage || {})]],
    ];
    return <div className="grid grid-cols-1 gap-3 py-2 text-[13px] @min-[900px]/page:grid-cols-2">{groups.map(([title,items])=><section key={title} className="rounded border border-stone-200 p-3 dark:border-stone-800"><h3 className="mb-2 text-[13px] font-medium">{title}</h3><div className="space-y-1">{items.map(([label,item])=><div key={label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3"><span className="text-stone-500">{label}</span><span className="break-all">{value(item)}</span></div>)}</div></section>)}</div>;
}
