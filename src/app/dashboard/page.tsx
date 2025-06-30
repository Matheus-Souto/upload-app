'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { toast } from 'sonner';
import { TemplateType } from '@/lib/template-webhook-service';

interface FileUpload {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
  createdAt: string;
  result?: string;
}

interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
  isProcessing: boolean;
  error?: boolean;
}

interface AxiosError extends Error {
  response?: {
    data?: {
      error?: string;
    };
  };
}

interface FileWithTemplate {
  file: File;
  template: TemplateType | null;
}

const TEMPLATE_OPTIONS = [
  { value: 'fatura-agibank', label: 'Fatura AGIBANK' },
  { value: 'extrato-agibank', label: 'Extrato AGIBANK' },
  { value: 'fatura-bmg', label: 'Fatura BMG' },
  { value: 'extrato-bmg', label: 'Extrato BMG' },
  { value: 'pje-remuneracao', label: 'PJE Remuneração' },
  { value: 'pje-horas', label: 'PJE Horas' },
] as const;

export default function DashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedFiles, setSelectedFiles] = useState<FileWithTemplate[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Polling para atualizar uploads em tempo real
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    }, 3000); // Atualiza a cada 3 segundos

    return () => clearInterval(interval);
  }, [queryClient]);

  // Buscar histórico de uploads
  const { data: uploads, isLoading: isLoadingUploads } = useQuery<FileUpload[]>(
    {
      queryKey: ['uploads'],
      queryFn: async () => {
        const response = await axios.get('/api/uploads');
        return response.data;
      },
    },
  );

  // Buscar estatísticas da fila a cada 3 segundos
  const { data: queueStats } = useQuery<QueueStatus>({
    queryKey: ['queue-stats'],
    queryFn: async () => {
      const response = await fetch('/api/queue-stats');
      if (!response.ok) {
        throw new Error('Erro ao buscar estatísticas da fila');
      }
      const data = await response.json();
      return data.stats;
    },
    refetchInterval: 3000,
  });

  // Mutação para upload de arquivo
  const uploadMutation = useMutation({
    mutationFn: async (filesWithTemplates: FileWithTemplate[]) => {
      const formData = new FormData();

      // Adicionar todos os arquivos ao FormData
      filesWithTemplates.forEach(fileItem => {
        formData.append('files', fileItem.file);
        formData.append('templates', fileItem.template!); // ! porque canUpload garante que não é null
      });

      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: progressEvent => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0;
          setUploadProgress(progress);
        },
      });

      return response.data;
    },
    onSuccess: data => {
      setSelectedFiles([]);
      setUploadProgress(0);

      // Invalidar e refetch da lista de uploads
      queryClient.invalidateQueries({ queryKey: ['uploads'] });

      // Toast de sucesso
      toast.success(`${data.successCount} arquivo(s) adicionado(s) à fila!`, {
        description: `${data.successCount} de ${
          data.totalFiles
        } arquivo(s) foram adicionados à fila de processamento.${
          data.errorCount > 0 ? ` ${data.errorCount} arquivo(s) falharam.` : ''
        }`,
      });
    },
    onError: (error: AxiosError) => {
      setUploadProgress(0);

      // Toast de erro
      toast.error('Erro no processamento', {
        description:
          error.response?.data?.error ||
          'Ocorreu um erro ao processar os arquivos.',
      });
    },
  });

  // Mutação para cancelar upload
  const cancelMutation = useMutation({
    mutationFn: async (uploadId: string) => {
      const response = await axios.put(
        `/api/uploads?id=${uploadId}&action=cancel`,
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidar e refetch da lista de uploads
      queryClient.invalidateQueries({ queryKey: ['uploads'] });

      // Toast de sucesso
      toast.success('Upload cancelado com sucesso!');
    },
    onError: (error: AxiosError) => {
      // Toast de erro
      toast.error('Erro ao cancelar upload', {
        description:
          error.response?.data?.error ||
          'Ocorreu um erro ao cancelar o upload.',
      });
    },
  });

  // Mutação para excluir upload
  const deleteMutation = useMutation({
    mutationFn: async (uploadId: string) => {
      const response = await axios.delete(`/api/uploads?id=${uploadId}`);
      return response.data;
    },
    onSuccess: () => {
      // Invalidar e refetch da lista de uploads
      queryClient.invalidateQueries({ queryKey: ['uploads'] });

      // Toast de sucesso
      toast.success('Upload excluído com sucesso!');
    },
    onError: (error: AxiosError) => {
      // Toast de erro
      toast.error('Erro ao excluir upload', {
        description:
          error.response?.data?.error || 'Ocorreu um erro ao excluir o upload.',
      });
    },
  });

  const validateFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    // Verificar limite de 10 arquivos
    if (fileArray.length > 10) {
      toast.error('Muitos arquivos selecionados', {
        description: 'Por favor, selecione no máximo 10 arquivos por vez.',
      });
      return false;
    }

    // Verificar se todos são PDFs
    for (const file of fileArray) {
      if (file.type !== 'application/pdf') {
        toast.error('Tipo de arquivo inválido', {
          description: `O arquivo "${file.name}" não é um PDF. Por favor, selecione apenas arquivos PDF.`,
        });
        return false;
      }
    }

    return true;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && validateFiles(files)) {
      setSelectedFiles(
        Array.from(files).map(file => ({
          file,
          template: null,
        })),
      );
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length > 0) {
      uploadMutation.mutate(selectedFiles);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleTemplateChange = (index: number, template: TemplateType) => {
    setSelectedFiles(prev =>
      prev.map((fileItem, i) =>
        i === index ? { ...fileItem, template } : fileItem,
      ),
    );
  };

  const handleCancel = async (uploadId: string, fileName: string) => {
    if (window.confirm(`Tem certeza que deseja cancelar "${fileName}"?`)) {
      cancelMutation.mutate(uploadId);
    }
  };

  const handleDelete = async (uploadId: string, fileName: string) => {
    if (window.confirm(`Tem certeza que deseja excluir "${fileName}"?`)) {
      deleteMutation.mutate(uploadId);
    }
  };

  // Calcular estatísticas dos uploads
  const errorCount = uploads
    ? uploads.filter(upload => upload.status === 'error').length
    : 0;
  const pendingCount = uploads
    ? uploads.filter(upload => upload.status === 'pending').length
    : 0;

  // Funções para drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0 && validateFiles(files)) {
      setSelectedFiles(
        Array.from(files).map(file => ({
          file,
          template: null,
        })),
      );
    }
  };

  const canUpload =
    selectedFiles.length > 0 &&
    selectedFiles.every(item => item.template !== null);

  if (status === 'loading') {
    return <div>Carregando...</div>;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header com botão de logout */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">
              Sistema de Upload de PDF
            </h1>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
            >
              Sair
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">
            Upload de Arquivo PDF
          </h2>

          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                isDragOver
                  ? 'border-indigo-500 bg-indigo-50'
                  : selectedFiles.length > 0
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                multiple
              />

              <div className="space-y-4">
                <div className="flex flex-col items-center">
                  <svg
                    className={`w-12 h-12 mb-4 ${
                      isDragOver
                        ? 'text-indigo-500'
                        : selectedFiles.length > 0
                        ? 'text-green-500'
                        : 'text-gray-400'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>

                  {isDragOver ? (
                    <p className="text-lg font-medium text-indigo-600">
                      Solte os arquivos aqui
                    </p>
                  ) : selectedFiles.length > 0 ? (
                    <div className="text-center">
                      <p className="text-lg font-medium text-green-600 mb-2">
                        Arquivos selecionados
                      </p>
                      <p className="text-sm text-gray-600">
                        {selectedFiles.map(file => file.file.name).join(', ')}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-lg font-medium text-gray-600 mb-2">
                        Arraste e solte seus arquivos PDF aqui
                      </p>
                      <p className="text-sm text-gray-500 mb-4">
                        ou clique para selecionar
                      </p>
                      <label
                        htmlFor="file-upload"
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
                      >
                        Selecionar Arquivos
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-medium text-gray-700">
                  Arquivos selecionados ({selectedFiles.length}/10):
                </h3>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {selectedFiles.map((fileItem, index) => (
                    <div
                      key={index}
                      className="bg-gray-50 rounded-lg p-4 border border-gray-200"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          <svg
                            className="w-4 h-4 text-red-500 flex-shrink-0"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-800 font-medium truncate block">
                              {fileItem.file.name}
                            </span>
                            <span className="text-xs text-gray-500">
                              ({(fileItem.file.size / 1024 / 1024).toFixed(2)}{' '}
                              MB)
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveFile(index)}
                          className="text-red-600 hover:text-red-800 p-1 ml-2 flex-shrink-0"
                          title="Remover arquivo"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>

                      <div className="ml-6">
                        <label className="block text-xs font-medium text-gray-600 mb-2">
                          Selecione o template:
                        </label>
                        <select
                          value={fileItem.template || ''}
                          onChange={e =>
                            handleTemplateChange(
                              index,
                              e.target.value as TemplateType,
                            )
                          }
                          className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="" className="text-gray-500">
                            Selecione um template...
                          </option>
                          {TEMPLATE_OPTIONS.map(option => (
                            <option
                              key={option.value}
                              value={option.value}
                              className="text-gray-900"
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {selectedFiles.some(item => item.template === null) && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <div className="flex">
                      <svg
                        className="w-5 h-5 text-yellow-400 mr-2 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <p className="text-sm text-yellow-700">
                        Selecione um template para todos os arquivos antes de
                        enviar.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedFiles.length > 0 && (
              <button
                onClick={handleUpload}
                disabled={uploadMutation.isPending || !canUpload}
                className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadMutation.isPending
                  ? 'Enviando...'
                  : !canUpload
                  ? 'Selecione os templates para continuar'
                  : 'Enviar Arquivos'}
              </button>
            )}

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-800">
              Histórico de Uploads
            </h2>

            {/* Status da fila */}
            <div className="flex items-center space-x-2">
              {queueStats?.isProcessing && (
                <div className="flex items-center text-blue-600">
                  <svg
                    className="w-4 h-4 mr-1 animate-spin"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Processando
                </div>
              )}

              {queueStats?.waiting && queueStats.waiting > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  {queueStats.waiting} aguardando
                </span>
              )}

              {queueStats?.active && queueStats.active > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {queueStats.active} ativo
                </span>
              )}

              {/* Contar erros da lista atual de uploads */}
              {errorCount > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  {errorCount} erro{errorCount > 1 ? 's' : ''}
                </span>
              )}

              {!queueStats?.isProcessing &&
                queueStats?.total === 0 &&
                pendingCount === 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Fila vazia
                  </span>
                )}
            </div>
          </div>

          {isLoadingUploads ? (
            <p className="text-gray-700">Carregando histórico...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Arquivo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Data
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {uploads?.map(upload => (
                    <tr key={upload.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">
                        {upload.fileName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            upload.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : upload.status === 'error'
                              ? 'bg-red-100 text-red-800'
                              : upload.status === 'processing'
                              ? 'bg-yellow-100 text-yellow-800'
                              : upload.status === 'pending'
                              ? 'bg-blue-100 text-blue-800'
                              : upload.status === 'cancelled'
                              ? 'bg-gray-100 text-gray-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {upload.status === 'completed'
                            ? 'Processado'
                            : upload.status === 'error'
                            ? 'Erro'
                            : upload.status === 'processing'
                            ? 'Processando'
                            : upload.status === 'pending'
                            ? 'Na Fila'
                            : upload.status === 'cancelled'
                            ? 'Cancelado'
                            : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {new Date(upload.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center space-x-2">
                          {upload.result && (
                            <a
                              href={upload.result}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                              title="Visualizar resultado"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                />
                              </svg>
                            </a>
                          )}

                          {upload.status === 'pending' && (
                            <button
                              onClick={() =>
                                handleCancel(upload.id, upload.fileName)
                              }
                              disabled={cancelMutation.isPending}
                              className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Cancelar upload"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          )}

                          <button
                            onClick={() =>
                              handleDelete(upload.id, upload.fileName)
                            }
                            disabled={deleteMutation.isPending}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Excluir upload"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
