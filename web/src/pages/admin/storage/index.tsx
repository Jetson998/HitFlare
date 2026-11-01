import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Space, Table, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchStorageDiagnostics, type StorageDiagnostics } from "@/services/api/management";
import { useUserStore } from "@/stores/use-user-store";

const bytes=(n:number)=>`${(n/1024**2).toFixed(2)} MiB`;
export default function AdminStoragePage() {
    const navigate=useNavigate(),identity=useUserStore(state=>state.user?.sessionId);
    const query=useQuery({queryKey:["admin-storage",identity],queryFn:fetchStorageDiagnostics,enabled:Boolean(identity)}),data=query.data;
    return <main className="h-full overflow-y-auto bg-background"><div className="workspace-page">
        <div className="workspace-heading"><div className="workspace-heading-copy"><h1 className="workspace-title">存储诊断</h1><p className="workspace-description">只读统计、引用保护与文件完整性扫描</p></div><Space><Button onClick={()=>navigate("/admin/users")}>用户管理</Button><Button onClick={()=>navigate("/admin/logs")}>管理日志</Button><Button type="primary" icon={<RefreshCw className="size-4"/>} loading={query.isFetching} onClick={()=>void query.refetch()}>重新扫描</Button></Space></div>
        <Alert className="mb-5" type="info" showIcon description="扫描不会删除文件。孤立候选仍可被新资产、生成历史或画布引用；清理策略确定后再提供清理操作。"/>
        {query.isError?<Alert type="error" showIcon description={query.error.message}/>:null}
        <Descriptions title="对象概览" size="small" items={[["登记容量",data?bytes(data.bytes):"—"],["媒体对象",data?.objects],["未引用对象",data?.orphanObjects],["缺失对象",data?.missingObjects],["不完整对象",data?.incompleteObjects],["半成品文件",data?.partialObjects],["未登记文件",data?.unindexedFiles]].map(([label,count])=>({key:String(label),label,children:count ?? "—"}))}/>
        <h2 className="my-4 text-base font-semibold">按用户占用</h2>
        <Table<StorageDiagnostics["users"][number]> rowKey="ownerUserId" size="small" loading={query.isPending} dataSource={data?.users || []} columns={[{title:"用户 ID",dataIndex:"ownerUserId"},{title:"对象数",dataIndex:"objects"},{title:"容量",dataIndex:"bytes",render:bytes}]} pagination={{pageSize:20,showSizeChanger:false}}/>
        <h2 className="my-4 text-base font-semibold">诊断候选</h2>
        <Table<StorageDiagnostics["candidates"][number]> rowKey="mediaId" size="small" dataSource={data?.candidates || []} columns={[{title:"媒体 ID",dataIndex:"mediaId"},{title:"用户 ID",dataIndex:"ownerUserId"},{title:"容量",dataIndex:"bytes",render:bytes},{title:"状态",render:(_,row)=><Space>{row.unreferenced?<Tag>未引用</Tag>:<Tag color="success">引用中</Tag>}{row.missing?<Tag color="error">文件缺失</Tag>:null}{row.incomplete?<Tag color="warning">文件不完整</Tag>:null}</Space>}]} scroll={{x:850}} pagination={{pageSize:20,showSizeChanger:false}}/>
    </div></main>;
}
