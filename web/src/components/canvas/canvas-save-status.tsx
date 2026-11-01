import { useEffect } from "react";
import { App, Button, Modal } from "antd";
import { useParams, useNavigate } from "react-router-dom";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function CanvasSaveStatus() {
    const { id = "" } = useParams(), navigate = useNavigate(), { message, modal } = App.useApp();
    const save = useCanvasStore(state => state.saves[id]), [status, error] = [save?.status || "saved", save?.error];
    useEffect(() => { if (status === "error" && error) message.error(error); }, [error, message, status]);
    const action = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { message.error(error instanceof Error ? error.message : "画布保存失败"); } };
    const reload = () => modal.confirm({ title: "重载服务器版本", content: "重载后会替换当前未保存草稿，请先另存或导出需要保留的内容。", okText: "重载", cancelText: "保留草稿", onOk: () => action(() => useCanvasStore.getState().reloadProject(id)) });
    const copy = () => action(async () => { const next = await useCanvasStore.getState().saveAsProject(id); navigate(`/canvas/${next}`); });
    return <>
        <span data-testid="canvas-save-status" className="flex items-center gap-2 text-xs opacity-70">
            {({ saved: "已保存", pending: "待保存", saving: "保存中", error: "保存失败", conflict: "版本冲突", deleted: "项目已删除" })[status]}
            {status === "error" ? <button type="button" className="hover:opacity-70" onClick={() => void action(() => useCanvasStore.getState().saveProject(id))}>重新保存</button> : null}
            {["conflict", "deleted"].includes(status) ? <button type="button" className="hover:opacity-70" onClick={() => void copy()}>另存草稿</button> : null}
        </span>
        <Modal title={status === "deleted" ? "项目已删除，当前草稿已保留" : "画布版本冲突"} open={status === "conflict" || status === "deleted"} closable={false} keyboard={false} mask={{ closable: false }} centered footer={<>
            <Button onClick={() => navigate("/canvas")}>返回项目列表</Button>
            {status === "conflict" ? <Button onClick={reload}>重载服务器版本</Button> : null}
            <Button type="primary" onClick={() => void copy()}>另存为新项目</Button>
        </>}><p className="text-sm">{error || "服务器项目已更新，自动保存已暂停。当前草稿只在此浏览器内存中保留，请选择重载或另存。"}</p></Modal>
    </>;
}
