import { useState } from "react";
import { encodeFunctionData, getAddress, parseAbi, parseEther } from "viem";
import { base } from "viem/chains";
import { erc7846Actions } from "viem/experimental";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWalletClient,
} from "wagmi";
import {
  baseConfig,
  buildRoutePlan,
  createDefaultPublicClient,
  executeRouterMulticall,
} from "zrouter-sdk";

// Custom replacer function to handle BigInt serialization
const bigIntReplacer = (_key: string, value: any) =>
  typeof value === "bigint" ? value.toString() : value;

function App() {
  const account = useAccount();
  const { connectors, connect, status, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { data: walletClient } = useWalletClient();

  const publicClient = usePublicClient();
  const chainId = useChainId();
  const {
    chains: switchableChains,
    switchChainAsync,
    status: switchStatus,
    error: switchError,
  } = useSwitchChain();

  const [messageSignature, setMessageSignature] = useState<string | null>(null);
  const [messageVerified, setMessageVerified] = useState<boolean | null>(null);
  const [typedDataSignature, setTypedDataSignature] = useState<string | null>(
    null
  );
  const [typedDataVerified, setTypedDataVerified] = useState<boolean | null>(
    null
  );
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [sendCallsResult, setSendCallsResult] = useState<any>(null);
  const [callsStatus, setCallsStatus] = useState<any>(null);
  const [walletConnectResult, setWalletConnectResult] = useState<any>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: txReceipt } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  async function handlePersonalSign() {
    try {
      setActionError(null);
      setMessageVerified(null);
      const message = "Hello, world!";
      const signature = await signMessageAsync({ message });
      setMessageSignature(signature);
      if (!publicClient || !account.addresses?.[0]) return;
      const isValid = await publicClient.verifyMessage({
        address: account.addresses[0],
        message,
        signature,
      });
      setMessageVerified(isValid);
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  async function handleTypedDataSign() {
    try {
      setActionError(null);
      setTypedDataVerified(null);
      const domain = {
        name: "Wallet Playground",
        version: "1",
        chainId: account.chainId,
        verifyingContract: "0x0000000000000000000000000000000000000000",
      } as const;
      const types = {
        Message: [{ name: "contents", type: "string" }],
      } as const;
      const primaryType = "Message" as const;
      const message = { contents: "Hello, world!" } as const;

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType,
        message,
      });
      setTypedDataSignature(signature);
      if (!publicClient || !account.addresses?.[0]) return;
      const isValid = await publicClient.verifyTypedData({
        address: account.addresses[0],
        domain,
        types,
        primaryType,
        message,
        signature,
      });
      setTypedDataVerified(isValid);
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  async function handleSendTransaction() {
    try {
      setActionError(null);
      if (!account.addresses?.[0]) throw new Error("No connected account");
      const hash = await sendTransactionAsync({
        // to: account.addresses[0],
        to: "0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89", // stephancill.eth
        value: parseEther("0"),
      });
      setTxHash(hash);
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  async function handleWalletConnect() {
    try {
      setActionError(null);
      setWalletConnectResult(null);

      const response = await walletClient?.extend(erc7846Actions()).connect({
        capabilities: {
          unstable_signInWithEthereum: {
            chainId: 1,
            nonce: "some-nonce",
          },
        },
      });

      setWalletConnectResult(response);
      console.log("response", response);
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  async function handleSendCalls() {
    try {
      setActionError(null);
      setSendCallsResult(null);
      setCallsStatus(null);

      if (!walletClient) throw new Error("No wallet client");

      const calls = [
        {
          to: getAddress("0x000000000000000000000000000000000001dEaD"),
          value: 0n,
          data: "0x1234",
        },
        {
          to: "0x78Ac792F13113f482F17E0699bBF4733096b73d8",
          data: encodeFunctionData({
            abi: parseAbi(["function increment()"]),
            functionName: "increment",
            args: [],
          }),
          value: 0n,
        },
        {
          to: "0x78Ac792F13113f482F17E0699bBF4733096b73d8",
          data: encodeFunctionData({
            abi: parseAbi(["function increment()"]),
            functionName: "increment",
            args: [],
          }),
          value: 0n,
        },
        {
          to: getAddress("0x000000000000000000000000000000000002dEaD"),
          value: 0n,
          data: "0x5678",
        },
      ] as const;

      const extendedClient = walletClient.extend(erc7846Actions());
      const result = await extendedClient.sendCalls({
        calls,
        forceAtomic: true,
      });

      setSendCallsResult(result);
      console.log("sendCalls result:", result);

      // Wait for the calls to complete
      if (result?.id) {
        try {
          console.log("Waiting for calls to complete...");
          const finalStatus = await extendedClient.waitForCallsStatus({
            id: result.id,
          });
          setCallsStatus(finalStatus);
          console.log("calls completed with status:", finalStatus);
        } catch (statusErr: any) {
          console.warn(
            "Failed to wait for calls status:",
            statusErr?.message ?? String(statusErr)
          );
          // Still try to get the current status as fallback
          try {
            const status = await extendedClient.getCallsStatus({
              id: result.id,
            });
            setCallsStatus(status);
            console.log("fallback calls status:", status);
          } catch (fallbackErr: any) {
            console.warn(
              "Fallback also failed:",
              fallbackErr?.message ?? String(fallbackErr)
            );
          }
        }
      }
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  async function handleCommentTransaction() {
    try {
      setActionError(null);
      const targetChainId = 8453; // Base
      if (chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      const to = "0xb262C9278fBcac384Ef59Fc49E24d800152E19b1" as `0x${string}`;
      const data =
        "0x762c08e2000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000008d25687829d6b85d9e0020b8c89e3ca24de20a89000000000000000000000000ea71ca49e1d8a368e63dcc56fdf54134a67e15bc888047a0eea29205317197f1bc369f311f9b4bc2a64e470f9d7fb21cd530b89100000000000000000000000000000000000000000000000000000198b959d576568d0bcd79caa0e094714e70cef45623a946b955114e8ff2907c12467a06c10d000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000000046c696b6500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041cc1fc925fa82794753afe727708b62242f620eb9dd312220527223d7fec7ea14230515a8665ad20785cf71427f1b4d6c5599e222981f291e8577e12d174c100d1b00000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

      const hash = await sendTransactionAsync({
        to,
        data,
        value: 0n,
      });
      setTxHash(hash);
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  async function handleSwapETHToUSDC() {
    try {
      setActionError(null);
      if (!account.addresses?.[0]) throw new Error("No connected account");

      const targetChainId = 8453; // Base
      if (chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      const zRouterPublicClient = createDefaultPublicClient(
        "https://mainnet.base.org",
        base
      );

      const owner = account.addresses[0] as `0x${string}`;
      const finalTo = owner;

      // Build the route plan
      const plan = await buildRoutePlan(zRouterPublicClient as any, {
        owner,
        router: baseConfig.router,
        steps: [
          {
            kind: "V2",
            to: owner,
            tokenIn: { address: "0x0000000000000000000000000000000000000000" }, // ETH
            tokenOut: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, // USDC on Base
            side: "EXACT_IN",
            amount: parseEther("0.00001"), // 0.00001 ETH
            limit: 0n,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 600), // 10 minutes
          },
        ],
        finalTo,
      });

      console.log("Route plan:", plan);

      // Handle approvals if needed
      if (plan.approvals.length > 0) {
        console.log("Approvals needed:", plan.approvals);
        // TODO: Handle approvals - for now we'll assume they're handled
      }

      // Execute the route
      if (!walletClient) throw new Error("No wallet client");
      const result = await executeRouterMulticall(
        zRouterPublicClient as any,
        walletClient,
        {
          calls: plan.calls,
          msgValue: plan.value,
          account: owner,
        }
      );

      setTxHash(result.hash);
    } catch (err: any) {
      setActionError(err?.message ?? String(err));
    }
  }

  return (
    <>
      <div>
        <h2>Account</h2>

        <div>
          status: {account.status}
          <br />
          addresses: {JSON.stringify(account.addresses, bigIntReplacer)}
          <br />
          chainId: {account.chainId}
        </div>

        {account.status === "connected" && (
          <button type="button" onClick={() => disconnect()}>
            Disconnect
          </button>
        )}
      </div>

      <div>
        <h2>Connect</h2>
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            type="button"
          >
            {connector.name}
          </button>
        ))}
        <div>{status}</div>
        <div>{error?.message}</div>
      </div>

      <div>
        <h2>Chain</h2>
        <div>current chainId: {chainId}</div>
        <div style={{ marginTop: 8 }}>
          {switchableChains.map((c) => (
            <button
              key={c.id}
              onClick={() => switchChainAsync({ chainId: c.id })}
              type="button"
              disabled={c.id === chainId}
            >
              {c.name} ({c.id}) {c.id === chainId ? "(current)" : ""}
            </button>
          ))}
        </div>
        <div>{switchStatus}</div>
        <div>{switchError?.message}</div>
      </div>

      {account.status === "connected" && (
        <div>
          <h2>Actions</h2>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handlePersonalSign}>
              personal_sign
            </button>
            {messageSignature && (
              <div>
                <div>signature: {messageSignature}</div>
                <div>verified: {String(messageVerified)}</div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handleTypedDataSign}>
              eth_signTypedData_v4
            </button>
            {typedDataSignature && (
              <div>
                <div>signature: {typedDataSignature}</div>
                <div>verified: {String(typedDataVerified)}</div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handleSendTransaction}>
              eth_sendTransaction (0 ETH)
            </button>
            {txHash && <div>txHash: {txHash}</div>}
            {txReceipt && <div>receipt status: {txReceipt.status}</div>}
          </div>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handleCommentTransaction}>
              comment transaction (Base)
            </button>
          </div>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handleWalletConnect}>
              wallet_connect
            </button>
            {walletConnectResult && (
              <div>
                <div>
                  wallet connect result:{" "}
                  {JSON.stringify(walletConnectResult, bigIntReplacer, 2)}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handleSendCalls}>
              wallet_sendCalls + waitForCallsStatus (batch 2 calls)
            </button>
            {sendCallsResult && (
              <div>
                <div>
                  result: {JSON.stringify(sendCallsResult, bigIntReplacer, 2)}
                </div>
              </div>
            )}
            {callsStatus && (
              <div>
                <div>
                  calls status: {JSON.stringify(callsStatus, bigIntReplacer, 2)}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={handleSwapETHToUSDC}>
              Swap 0.00001 ETH to USDC (Base)
            </button>
            {txHash && <div>txHash: {txHash}</div>}
            {txReceipt && <div>receipt status: {txReceipt.status}</div>}
          </div>

          {actionError && <div style={{ color: "red" }}>{actionError}</div>}
        </div>
      )}
    </>
  );
}

export default App;
